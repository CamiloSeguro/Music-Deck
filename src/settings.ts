/**
 * settings.ts
 * Ajustes globales del plugin (los mismos para todos los botones), editados
 * desde el Property Inspector de VSD Craft y guardados con setGlobalSettings.
 */

export interface Settings {
  /** Adelanto de la letra en ms (positivo = la letra aparece antes) */
  lyricsOffsetMs: number;
  /** Tamaño del texto de la barra de letra */
  lyricsSize:     'small' | 'medium' | 'large';
  /** Mostrar la siguiente línea debajo de la actual */
  showNextLine:   boolean;
  /** Ir coloreando la línea actual mientras se canta */
  karaoke:        boolean;
  /** 'cover' = color sacado de la portada; 'fixed' = accentColor */
  accentMode:     'cover' | 'fixed';
  accentColor:    string;
  /** Segundos por clic al girar los knobs 0–1 */
  seekStep:       number;
  /** Puntos de volumen (%) por clic al girar los knobs 2–3 */
  volumeStep:     number;
}

export const DEFAULT_SETTINGS: Settings = {
  lyricsOffsetMs: 200,
  lyricsSize:     'medium',
  showNextLine:   true,
  karaoke:        true,
  accentMode:     'cover',
  accentColor:    '#e03030',
  seekStep:       5,
  volumeStep:     2,
};

let current: Settings = { ...DEFAULT_SETTINGS };
let version = 0;

export function getSettings(): Settings { return current; }

/** Cambia cada vez que cambian los ajustes (para invalidar renders cacheados). */
export function settingsVersion(): number { return version; }

/** Aplica ajustes recibidos (validando cada campo; lo inválido queda por defecto). */
export function applySettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, def: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v))
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v)))
    : def;
  const oneOf = <T extends string>(v: unknown, opts: readonly T[], def: T): T =>
    opts.includes(v as T) ? (v as T) : def;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const D = DEFAULT_SETTINGS;

  current = {
    lyricsOffsetMs: num(r['lyricsOffsetMs'], -2000, 2000, D.lyricsOffsetMs),
    lyricsSize:     oneOf(r['lyricsSize'], ['small', 'medium', 'large'] as const, D.lyricsSize),
    showNextLine:   bool(r['showNextLine'], D.showNextLine),
    karaoke:        bool(r['karaoke'], D.karaoke),
    accentMode:     oneOf(r['accentMode'], ['cover', 'fixed'] as const, D.accentMode),
    accentColor:    typeof r['accentColor'] === 'string' && /^#[0-9a-f]{6}$/i.test(r['accentColor'])
                      ? r['accentColor'] : D.accentColor,
    seekStep:       num(r['seekStep'], 1, 60, D.seekStep),
    volumeStep:     num(r['volumeStep'], 1, 20, D.volumeStep),
  };
  version++;
  return current;
}
