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

/** Devuelve la línea anterior, actual y siguiente */
export function lyricsWindow(lyrics: LyricLine[], position: number): LyricsWindow {
  const idx = currentLyricIndex(lyrics, position);

  return {
    previous: idx > 0                        ? lyrics[idx - 1].text : '',
    current:  idx >= 0                       ? lyrics[idx].text     : '',
    next:     idx >= 0 && idx < lyrics.length - 1 ? lyrics[idx + 1].text : '',
  };
}
