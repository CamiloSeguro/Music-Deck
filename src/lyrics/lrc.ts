/**
 * lrc.ts
 * Parser del formato LRC ("[mm:ss.xx] texto") de LRCLIB.
 */
import type { LyricLine } from '../types';

export function parseLrc(lrc: string): LyricLine[] {
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
