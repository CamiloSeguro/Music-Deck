/**
 * lrclib.ts
 * Busca letras sincronizadas en LRCLIB.
 *  - Windows: delega la llamada HTTP a SmtcNative.exe, que usa .NET HttpClient
 *    (el https de Node.js en el contexto del plugin no funciona).
 *  - Mac: llamada directa con fetch.
 *
 * Las letras encontradas se guardan en disco (<plugin>/cache/lyrics.json, LRU de
 * CACHE_MAX canciones): LRCLIB a veces responde 503 y así las canciones ya
 * escuchadas no dependen de él, ni siquiera tras reiniciar.
 */
import { execFile } from 'child_process';
import { platform } from 'os';
import { join }     from 'path';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { findExe }  from '../providers/smtc-windows';
import { log }      from '../log';
import { parseLrc } from './lrc';
import type { LyricLine } from '../types';

// __dirname = bin/lyrics/ → subir dos niveles al plugin root
const CACHE_DIR  = join(__dirname, '..', '..', 'cache');
const CACHE_FILE = join(CACHE_DIR, 'lyrics.json');
const CACHE_MAX  = 500;

// "title|artist" → LyricLine[]; el orden del Map es el del LRU (último = más reciente)
const cache    = new Map<string, LyricLine[]>();
const inFlight = new Map<string, Promise<LyricLine[]>>();

export async function fetchLyrics(
  title:    string,
  artist:   string,
  album:    string,
  duration: number,
): Promise<LyricLine[]> {
  loadDiskCache();
  const key = `${title}|${artist}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);   // mover al final (más reciente)
    cache.set(key, hit);
    return hit;
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = (platform() === 'win32'
      ? fetchViaExe(title, artist, album, duration)
      : fetchViaHttp(title, artist, album, duration)
    ).then((lines) => {
      // Un resultado vacío puede ser un fallo de red: no lo cacheamos para poder reintentar
      if (lines.length > 0) {
        cache.set(key, lines);
        scheduleSave();
      }
      inFlight.delete(key);
      log(`[lyrics] "${title}" — ${artist}: ${lines.length} líneas`);
      return lines;
    });
    inFlight.set(key, pending);
  }
  return pending;
}

// ─── Cache en disco ───────────────────────────────────────────────────────────

let diskLoaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function loadDiskCache(): void {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Record<string, LyricLine[]>;
    for (const [key, lines] of Object.entries(data)) {
      if (Array.isArray(lines) && lines.length > 0 && !cache.has(key)) cache.set(key, lines);
    }
    log(`[lyrics] cache en disco: ${cache.size} canciones`);
  } catch { /* sin cache todavía */ }
}

/** Guarda en disco unos segundos después del último cambio (agrupa varias escrituras). */
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      mkdirSync(CACHE_DIR, { recursive: true });
      const tmp = `${CACHE_FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(cache)));
      renameSync(tmp, CACHE_FILE);   // atómico: nunca queda un JSON a medias
    } catch (err) {
      log(`[lyrics] no se pudo guardar el cache: ${String(err)}`);
    }
  }, 3_000);
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
