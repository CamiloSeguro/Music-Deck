/**
 * lrclib.ts
 * Busca letras sincronizadas delegando la llamada HTTP a SmtcNative.exe,
 * que usa .NET HttpClient (el https de Node.js en el contexto del plugin no funciona).
 */
import { execFile } from 'child_process';
import { join }     from 'path';
import type { LyricLine } from '../types';

// __dirname = bin/lyrics/ → subir dos niveles al plugin root → scripts/
const EXE = join(__dirname, '..', '..', 'scripts', 'SmtcNative', 'bin', 'Release',
                 'net10.0-windows10.0.19041.0', 'SmtcNative.exe');

// Cache en memoria: "title|artist" → LyricLine[]
const cache = new Map<string, LyricLine[]>();

export async function fetchLyrics(
  title:    string,
  artist:   string,
  album:    string,
  duration: number,
): Promise<LyricLine[]> {
  const key = `${title}|${artist}`;
  if (cache.has(key)) return cache.get(key)!;

  return new Promise<LyricLine[]>((resolve) => {
    const proc = execFile(
      EXE,
      ['lyrics', title, artist, album, Math.round(duration).toString()],
      { timeout: 30_000 },
      (_err, stdout) => {
        try {
          const lines = JSON.parse(stdout.trim()) as LyricLine[];
          cache.set(key, Array.isArray(lines) ? lines : []);
          resolve(cache.get(key)!);
        } catch {
          cache.set(key, []);
          resolve([]);
        }
      },
    );
    proc.on('error', () => { cache.set(key, []); resolve([]); });
  });
}
