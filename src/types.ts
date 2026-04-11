// ─── Shared types for Music Deck ────────────────────────────────────────────

export interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  /** Base64-encoded album art (JPEG or PNG) — null si no hay portada */
  thumbnailBase64: string | null;
  isPlaying: boolean;
  /** Posición actual en segundos */
  position: number;
  /** Duración total en segundos */
  duration: number;
  /** App fuente: "Spotify.exe", "AppleMusic.exe", "Apple Music", etc. */
  source: string;
}

export interface LyricLine {
  /** Tiempo de aparición en segundos */
  time: number;
  text: string;
}

export type ControlAction = 'play' | 'pause' | 'togglePlay' | 'next' | 'previous';

/** Columna del encoder en el Stream Deck+ (0–3) → qué mostrar */
export type SlotRole = 'art' | 'info' | 'lyric-current' | 'lyric-next' | 'compact';
