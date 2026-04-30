/**
 * media-manager.ts
 * En Windows: lee el caché de smtc-windows (proceso .NET persistente).
 * En Mac: prueba Apple Music primero; si no está reproduciendo, prueba Spotify.
 * Notifica a los listeners cuando cambia la canción o el estado de play.
 */
import { platform } from 'os';
import type { MediaInfo, ControlAction } from '../types';
import {
  startSmtcLoop,
  stopSmtcLoop,
  getSmtcCurrentMedia,
  smtcControl,
} from './smtc-windows';
import { getAppleMusicInfo, appleMusicControl } from './apple-music-mac';
import { getSpotifyInfo, spotifyControl } from './spotify-mac';

type ChangeCallback = (info: MediaInfo | null) => void;
type MacSource = 'Apple Music' | 'Spotify' | null;

class MediaManager {
  private current: MediaInfo | null = null;
  private listeners: ChangeCallback[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly isWindows = platform() === 'win32';
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

  getCurrent(): MediaInfo | null { return this.current; }

  async control(action: ControlAction): Promise<void> {
    if (this.isWindows) {
      await smtcControl(action);
    } else {
      // Controlar la fuente que está activa actualmente
      if (this.macSource === 'Spotify') await spotifyControl(action);
      else                               await appleMusicControl(action);
    }
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

    if (this.hasChanged(next)) {
      this.current = next;
      this.notify(next);
    } else if (next && this.current) {
      if (next.position !== this.current.position) {
        this.current = next;
      }
    }
  }

  private hasChanged(next: MediaInfo | null): boolean {
    if (!this.current && !next) return false;
    if (!this.current || !next)  return true;
    return (
      this.current.title     !== next.title  ||
      this.current.artist    !== next.artist ||
      this.current.isPlaying !== next.isPlaying
    );
  }

  private notify(info: MediaInfo | null): void {
    for (const cb of this.listeners) {
      try { cb(info); } catch { /* ignorar errores en listeners */ }
    }
  }
}

export const mediaManager = new MediaManager();
