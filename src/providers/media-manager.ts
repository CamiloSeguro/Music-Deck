/**
 * media-manager.ts
 * En Windows: lee el caché de smtc-windows (proceso PowerShell persistente).
 * En Mac: llama AppleScript cada 1 s.
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

type ChangeCallback = (info: MediaInfo | null) => void;

class MediaManager {
  private current: MediaInfo | null = null;
  private listeners: ChangeCallback[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly isWindows = platform() === 'win32';

  onMediaChange(cb: ChangeCallback): void {
    this.listeners.push(cb);
  }

  /** Inicia el proceso de lectura de media */
  start(intervalMs = 500): void {
    if (this.timer) return;

    if (this.isWindows) {
      // Arranca el proceso PowerShell persistente
      startSmtcLoop();
    }

    // Tick que comprueba el estado (en Windows solo lee el caché, muy barato)
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.isWindows) stopSmtcLoop();
  }

  getCurrent(): MediaInfo | null { return this.current; }

  async control(action: ControlAction): Promise<void> {
    if (this.isWindows) await smtcControl(action);
    else                await appleMusicControl(action);
  }

  private async tick(): Promise<void> {
    const next = this.isWindows
      ? getSmtcCurrentMedia()           // lectura desde caché — O(1)
      : await getAppleMusicInfo();      // AppleScript — async

    if (this.hasChanged(next)) {
      this.current = next;
      this.notify(next);
    } else if (next && this.current) {
      // Actualizar posición siempre (SmtcNative lee a 200 ms, posición cambia constantemente)
      if (next.position !== this.current.position) {
        this.current = next;
        // No notificar listeners por cambio de posición solo (evita re-búsqueda de letras)
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
