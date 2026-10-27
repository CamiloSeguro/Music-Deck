/**
 * sync.ts
 * Dado el array de letras (LyricLine[]) y la posición actual en segundos,
 * determina qué línea está activa y devuelve ventana de contexto.
 */
import type { LyricLine } from '../types';

/** Devuelve el índice de la línea activa (-1 si no hay ninguna aún) */
export function currentLyricIndex(lyrics: LyricLine[], position: number): number {
  if (lyrics.length === 0) return -1;

  let idx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time <= position) idx = i;
    else break;
  }
  return idx;
}

export interface LyricsWindow {
  previous: string;
  current:  string;
  next:     string;
}

/**
 * Qué tanto de la línea `idx` ya se cantó (0–1), para el efecto karaoke.
 * LRCLIB solo da el inicio de cada línea, así que se estima: la línea se canta
 * en ~0.35 s por palabra (mín. 1.5 s), sin pasar del inicio de la siguiente.
 * Así una línea seguida de un instrumental largo no se llena a cámara lenta.
 */
export function lineProgress(lyrics: LyricLine[], idx: number, position: number): number {
  if (idx < 0 || idx >= lyrics.length) return 0;
  const start = lyrics[idx].time;
  const gap   = idx + 1 < lyrics.length ? lyrics[idx + 1].time - start : Infinity;
  const words = lyrics[idx].text.split(/\s+/).filter(Boolean).length;
  const sung  = Math.min(gap, Math.max(1.5, words * 0.35));
  return Math.min(1, Math.max(0, (position - start) / sung));
}

/** Devuelve la línea anterior, actual y siguiente */
export function lyricsWindow(lyrics: LyricLine[], position: number): LyricsWindow {
  const idx = currentLyricIndex(lyrics, position);

  return {
    previous: idx > 0                        ? lyrics[idx - 1].text : '',
    current:  idx >= 0                       ? lyrics[idx].text     : '',
    next:     idx >= 0 && idx < lyrics.length - 1 ? lyrics[idx + 1].text : '',
  };
}
