/**
 * media-manager.ts
 * En Windows: lee el caché de smtc-windows (proceso .NET persistente).
 * En Mac: prueba Apple Music primero; si no está reproduciendo, prueba Spotify.
 * Notifica a los listeners cuando cambia la canción o el estado de play.
 *
 * La posición se suaviza con PositionSmoother y se calcula en cada getCurrent(),
 * así la letra avanza con el reloj y no a saltos de cada lectura.
 */
import { platform } from 'os';
import type { MediaInfo, ControlAction } from '../types';
import {
  startSmtcLoop,
  stopSmtcLoop,
  getSmtcCurrentMedia,
  smtcControl,
  smtcSeekBy,
  smtcVolumeBy,
  smtcSetSpectrum,
  getSmtcSpectrum,
} from './smtc-windows';
import { getAppleMusicInfo, appleMusicControl, appleMusicSeekBy, macVolumeBy } from './apple-music-mac';
import { getSpotifyInfo, spotifyControl, spotifySeekBy } from './spotify-mac';
import { PositionSmoother } from './position';

type ChangeCallback = (info: MediaInfo | null) => void;
type MacSource = 'Apple Music' | 'Spotify' | null;

class MediaManager {
  private current: MediaInfo | null = null;
  private listeners: ChangeCallback[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly isWindows = platform() === 'win32';
  private readonly position  = new PositionSmoother();
  /** Última fuente activa en Mac — determina a qué app enviar controles */
  private macSource: MacSource = null;

  onMediaChange(cb: ChangeCallback): void {
    this.listeners.push(cb);
  }

  start(intervalMs = 500): void {
    if (this.timer) return;

    if (this.isWindows) {
      startSmtcLoop();
    }

    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.isWindows) stopSmtcLoop();
  }

  /** Media actual con la posición estimada para este instante. */
  getCurrent(): MediaInfo | null {
    if (!this.current) return null;
    const pos = this.position.at(Date.now());
    return { ...this.current, position: Math.min(Math.max(0, pos), this.current.duration || Infinity) };
  }

  async control(action: ControlAction): Promise<void> {
    if (this.isWindows) {
      await smtcControl(action);
    } else {
      // Controlar la fuente que está activa actualmente
      if (this.macSource === 'Spotify') await spotifyControl(action);
      else                               await appleMusicControl(action);
    }
  }

  async seekBy(seconds: number): Promise<void> {
    if (this.isWindows)                    await smtcSeekBy(seconds);
    else if (this.macSource === 'Spotify') await spotifySeekBy(seconds);
    else                                   await appleMusicSeekBy(seconds);
    // Mover la estimación ya, sin esperar a la próxima lectura
    if (this.current) {
      const key = `${this.current.title}|${this.current.artist}`;
      const now = Date.now();
      this.position.update(key, Math.max(0, this.position.at(now) + seconds), this.current.isPlaying, now);
    }
  }

  /** Cambia el volumen del sistema (delta −1…1); devuelve el nivel nuevo (0–1) si se conoce. */
  volumeBy(delta: number): Promise<number | null> {
    return this.isWindows ? smtcVolumeBy(delta) : macVolumeBy(delta);
  }

  /** Espectro de audio real (solo Windows); en Mac el visualizador sigue simulado. */
  setSpectrum(on: boolean): void {
    if (this.isWindows) smtcSetSpectrum(on);
  }

  getSpectrum(): number[] | null {
    return this.isWindows ? getSmtcSpectrum() : null;
  }

  private async getMacMedia(): Promise<MediaInfo | null> {
    // Prueba Apple Music primero
    const am = await getAppleMusicInfo();
    if (am?.isPlaying) {
      this.macSource = 'Apple Music';
      return am;
    }

    // Prueba Spotify
    const sp = await getSpotifyInfo();
    if (sp?.isPlaying) {
      this.macSource = 'Spotify';
      return sp;
    }

    // Ninguna está reproduciendo — devuelve la que esté pausada (si la hay)
    if (am) { this.macSource = 'Apple Music'; return am; }
    if (sp) { this.macSource = 'Spotify';     return sp; }

    this.macSource = null;
    return null;
  }

  private async tick(): Promise<void> {
    const next = this.isWindows
      ? getSmtcCurrentMedia()
      : await this.getMacMedia();

    if (next) {
      this.position.update(`${next.title}|${next.artist}`, next.position, next.isPlaying, Date.now());
    }

    const changed = this.hasChanged(next);
    this.current  = next;
    if (changed) this.notify(next);
  }

  private hasChanged(next: MediaInfo | null): boolean {
    if (!this.current && !next) return false;
    if (!this.current || !next)  return true;
    return (
      this.current.title           !== next.title     ||
      this.current.artist          !== next.artist    ||
      this.current.isPlaying       !== next.isPlaying ||
      this.current.thumbnailBase64 !== next.thumbnailBase64
    );
  }

  private notify(info: MediaInfo | null): void {
    for (const cb of this.listeners) {
      try { cb(info); } catch { /* ignorar errores en listeners */ }
    }
  }
}

export const mediaManager = new MediaManager();
