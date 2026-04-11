/**
 * now-playing.ts
 * Acción principal de Music Deck.
 *
 * Soporta ENCODER (pantalla touch del Stream Deck+) y KEYPAD (tecla normal).
 *
 * Encoder — distribución según la columna del encoder (0–3):
 *   Col 0 → portada / visualizador
 *   Col 1 → título + artista + progreso
 *   Col 2 → letra actual (resaltada)
 *   Col 3 → letra siguiente (atenuada)
 *   Otro  → modo compacto (todo junto)
 *
 * Keypad — muestra imagen compacta de 144×144 (misma lógica, escala diferente).
 *
 * Interacciones:
 *   - Touch tap / Key press → Play / Pause
 *   - Dial rotate            → (reservado para volumen en futuras versiones)
 */
import { action, SingletonAction } from '@elgato/streamdeck';
import type {
  WillAppearEvent,
  WillDisappearEvent,
  KeyDownEvent,
  DialDownEvent,
  TouchTapEvent,
} from '@elgato/streamdeck';

import { mediaManager }    from '../providers/media-manager';
import { fetchLyrics }     from '../lyrics/lrclib';
import { renderSlot }      from '../ui/canvas-renderer';
import { createVisualizer, updateVisualizer } from '../ui/visualizer';
import type { MediaInfo, LyricLine, SlotRole } from '../types';
import type { VisualizerState }                from '../ui/visualizer';

// Mapeo columna → rol del slot
const SLOT_MAP: Record<number, SlotRole> = {
  0: 'art',
  1: 'info',
  2: 'lyric-current',
  3: 'lyric-next',
};

interface Instance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: any;
  column: number;
  isEncoder: boolean;
}

@action({ UUID: 'dev.camiloseguro.musicdeck.nowplaying' })
export class NowPlayingAction extends SingletonAction {
  // Instancias activas (puede haber hasta 4 encoders + varios keys)
  private readonly instances = new Map<string, Instance>();

  // Estado compartido
  private lyrics:   LyricLine[]      = [];
  private viz:      VisualizerState   = createVisualizer();
  private lastKey   = '';             // "title|artist" para detectar cambio de canción
  private renderTick: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    // Reaccionar a cambios de canción para cargar nuevas letras
    mediaManager.onMediaChange(media => void this.onMediaChange(media));
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const isEncoder = !ev.action.isKey();
    const col       = (ev.payload.coordinates as { column: number }).column ?? 0;

    this.instances.set(ev.action.id, { action: ev.action, column: col, isEncoder });

    if (isEncoder) {
      await ev.action.setFeedbackLayout('layouts/touch.json');
    }

    // Arrancar render loop si es la primera instancia
    if (this.instances.size === 1) {
      this.startLoop();
    }

    // Render inmediato
    await this.renderInstance(ev.action.id, mediaManager.getCurrent());
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    this.instances.delete(ev.action.id);
    if (this.instances.size === 0) this.stopLoop();
  }

  // ─── Interacciones ──────────────────────────────────────────────────────────

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await mediaManager.control('togglePlay');
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    await mediaManager.control('togglePlay');
  }

  override async onTouchTap(_ev: TouchTapEvent): Promise<void> {
    await mediaManager.control('togglePlay');
  }

  // ─── Render loop (250 ms) ───────────────────────────────────────────────────

  private startLoop(): void {
    this.renderTick = setInterval(() => void this.renderAll(), 250);
  }

  private stopLoop(): void {
    if (this.renderTick) { clearInterval(this.renderTick); this.renderTick = null; }
  }

  private async renderAll(): Promise<void> {
    const media = mediaManager.getCurrent();
    this.viz    = updateVisualizer(this.viz, media?.isPlaying ?? false);

    await Promise.all(
      Array.from(this.instances.keys()).map(id => this.renderInstance(id, media))
    );
  }

  private async renderInstance(id: string, media: MediaInfo | null): Promise<void> {
    const inst = this.instances.get(id);
    if (!inst) return;

    try {
      if (inst.isEncoder) {
        const role  = SLOT_MAP[inst.column] ?? 'compact';
        const imgB64 = await renderSlot(role, media, this.lyrics, this.viz);
        await inst.action.setFeedback({ image: imgB64 });
      } else {
        // Keypad: imagen cuadrada (el SDK reescalará)
        const imgB64 = await renderSlot('compact', media, this.lyrics, this.viz);
        await inst.action.setImage(imgB64);
      }
    } catch {
      // Ignorar errores de render individuales
    }
  }

  // ─── Cambio de canción → buscar letras ──────────────────────────────────────

  private async onMediaChange(media: MediaInfo | null): Promise<void> {
    if (!media) { this.lyrics = []; return; }

    const key = `${media.title}|${media.artist}`;
    if (key === this.lastKey) return;

    this.lastKey = key;
    this.lyrics  = [];   // limpiar mientras carga

    this.lyrics = await fetchLyrics(media.title, media.artist, media.album, media.duration);
  }
}
