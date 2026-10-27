/**
 * lrclib.ts
 * Busca letras sincronizadas en LRCLIB.
 *  - Windows: delega la llamada HTTP a SmtcNative.exe, que usa .NET HttpClient
 *    (el https de Node.js en el contexto del plugin no funciona).
 *  - Mac: llamada directa con fetch.
 */
import { execFile } from 'child_process';
import { platform } from 'os';
import { findExe }  from '../providers/smtc-windows';
import { log }      from '../log';
import type { LyricLine } from '../types';

// Cache en memoria: "title|artist" → LyricLine[]
const cache    = new Map<string, LyricLine[]>();
const inFlight = new Map<string, Promise<LyricLine[]>>();

export async function fetchLyrics(
  title:    string,
  artist:   string,
  album:    string,
  duration: number,
): Promise<LyricLine[]> {
  const key = `${title}|${artist}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = (platform() === 'win32'
      ? fetchViaExe(title, artist, album, duration)
      : fetchViaHttp(title, artist, album, duration)
    ).then((lines) => {
      // Un resultado vacío puede ser un fallo de red: no lo cacheamos para poder reintentar
      if (lines.length > 0) cache.set(key, lines);
      inFlight.delete(key);
      log(`[lyrics] "${title}" — ${artist}: ${lines.length} líneas`);
      return lines;
    });
    inFlight.set(key, pending);
  }
  return pending;
}

function fetchViaExe(title: string, artist: string, album: string, duration: number): Promise<LyricLine[]> {
  return new Promise<LyricLine[]>((resolve) => {
    const exe = findExe();
    if (!exe) { resolve([]); return; }

    const proc = execFile(
      exe,
      ['lyrics', title, artist, album, Math.round(duration).toString()],
      { timeout: 30_000 },
      (_err, stdout) => {
        try {
          const lines = JSON.parse(stdout.trim()) as LyricLine[];
          resolve(Array.isArray(lines) ? lines : []);
        } catch {
          resolve([]);
        }
      },
    );
    proc.on('error', () => resolve([]));
  });
}

// ─── Mac: HTTP directo ────────────────────────────────────────────────────────

interface LrcLibResponse { syncedLyrics?: string | null }

async function fetchViaHttp(title: string, artist: string, album: string, duration: number): Promise<LyricLine[]> {
  const base = `track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
  const exact = `${base}&album_name=${encodeURIComponent(album)}&duration=${Math.round(duration)}`;

  const got = await getJson<LrcLibResponse>(`https://lrclib.net/api/get?${exact}`)
           ?? await getJson<LrcLibResponse>(`https://lrclib.net/api/get?${base}`);
  if (got?.syncedLyrics) {
    const lines = parseLrc(got.syncedLyrics);
    if (lines.length > 0) return lines;
  }

  const results = await getJson<LrcLibResponse[]>(`https://lrclib.net/api/search?${base}`) ?? [];
  for (const r of results) {
    if (!r.syncedLyrics) continue;
    const lines = parseLrc(r.syncedLyrics);
    if (lines.length > 0) return lines;
  }
  return [];
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MusicDeck/1.0' },
      signal:  AbortSignal.timeout(8_000),
    });
    return res.ok ? (await res.json() as T) : null;
  } catch {
    return null;
  }
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const m = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/.exec(raw);
    if (!m) continue;
    const text = m[4].trim();
    if (!text) continue;
    const frac = m[3].length === 3 ? Number(m[3]) / 1000 : Number(m[3]) / 100;
    lines.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}
