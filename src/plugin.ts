/**
 * plugin.ts — Music Deck para StreamDock (HotSpot)
 *
 * Arquitectura:
 *  - sd (streamdock.ts) maneja el WebSocket con el software de StreamDock
 *  - mediaManager (providers/media-manager.ts) hace polling de SMTC (Windows)
 *    o AppleScript (Mac) cada 500 ms
 *  - canvas-renderer.ts renderiza las imágenes para la pantalla touch (800×80)
 *    y para los botones de control (144×144)
 *  - lrclib.ts busca letras sincronizadas (LRC) y sync.ts las sincroniza
 */

import { sd }            from './streamdock';
import { mediaManager }  from './providers/media-manager';
import { appendFileSync } from 'fs';
import { join }           from 'path';

const DEBUG_LOG = join(__dirname, '..', 'debug.log');
function dbg(msg: string): void {
  try { appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* noop */ }
}
import { fetchLyrics }   from './lyrics/lrclib';
import {
  renderTouchStrip,
  renderControlKey,
} from './ui/canvas-renderer';
import {
  createVisualizer,
  updateVisualizer,
} from './ui/visualizer';
import type { MediaInfo, LyricLine, ControlAction } from './types';

// ─── Estado global ────────────────────────────────────────────────────────────

/** Contextos activos del touchbar: context → touchbarWidth */
const touchContexts = new Map<string, number>();

/** Contextos activos de botones → UUID de la acción */
const keyContexts   = new Map<string, string>();

let lyrics:  LyricLine[] = [];
let viz                  = createVisualizer();
let lastSongKey          = '';   // "title|artist" para detectar cambio de canción

// ─── Cambio de canción → buscar letras ────────────────────────────────────────

mediaManager.onMediaChange(async (media: MediaInfo | null) => {
  if (!media) { lyrics = []; return; }

  const key = `${media.title}|${media.artist}`;
  if (key === lastSongKey) return;

  lastSongKey = key;
  lyrics      = [];

  dbg(`fetchLyrics START title="${media.title}" artist="${media.artist}" album="${media.album}" duration=${media.duration}`);
  const fetched = await fetchLyrics(media.title, media.artist, media.album, media.duration);
  dbg(`fetchLyrics END lines=${fetched.length} currentKey=${lastSongKey} myKey=${key}`);
  // Solo aplicar si la canción no cambió durante el fetch (evita race condition)
  if (lastSongKey === key) {
    lyrics = fetched;
  } else {
    dbg(`fetchLyrics DISCARDED (song changed while fetching)`);
  }
});

// ─── Loop de render (250 ms) ─────────────────────────────────────────────────

let _renderCount = 0;
setInterval(async () => {
  const media = mediaManager.getCurrent();
  _renderCount++;
  if (_renderCount % 20 === 1) {   // cada ~5s
    dbg(`render tick media=${media ? `"${media.title}|${media.artist}" playing=${String(media.isPlaying)}` : 'null'} touchCtx=${touchContexts.size} keyCtx=${keyContexts.size}`);
  }
  viz = updateVisualizer(viz, media?.isPlaying ?? false);

  // Actualizar pantalla touch
  for (const [ctx, tbWidth] of touchContexts) {
    try {
      const img = await renderTouchStrip(media, lyrics, viz, tbWidth);
      sd.setImage(ctx, img);
    } catch (err) {
      console.error('[render touch]', err);
    }
  }

  // Actualizar botones de control
  for (const [ctx, actionId] of keyContexts) {
    try {
      const img = await renderControlKey(actionId, media);
      sd.setImage(ctx, img);
    } catch (err) {
      console.error('[render key]', err);
    }
  }
}, 250);

// ─── Eventos StreamDock ───────────────────────────────────────────────────────

sd.on('willAppear', async ({ action, context, payload }) => {
  if (!context || !action) return;

  // HotSpot StreamDock: el touchbar llega con controller=Keypad pero coordinates={column:-1, row:-1}
  // y settings.touchbarWidth indica el ancho real de la franja.
  const coords = payload?.coordinates as { column?: number; row?: number } | undefined;
  const isTouch = coords?.column === -1 && coords?.row === -1;
  dbg(`willAppear action=${action} context=${context} isTouch=${String(isTouch)} coords=${JSON.stringify(coords)} settings=${JSON.stringify(payload?.settings)}`);
  const touchbarWidth: number = (payload?.settings as Record<string, unknown> | undefined)?.touchbarWidth as number | undefined ?? 750;

  if (isTouch) {
    touchContexts.set(context, touchbarWidth);
    const img = await renderTouchStrip(mediaManager.getCurrent(), lyrics, viz, touchbarWidth);
    sd.setImage(context, img);
  } else {
    keyContexts.set(context, action);
    const img = await renderControlKey(action, mediaManager.getCurrent());
    sd.setImage(context, img);
  }
});

sd.on('willDisappear', ({ context }) => {
  if (!context) return;
  touchContexts.delete(context);
  keyContexts.delete(context);
  dbg(`willDisappear context=${context}`);
});

// keyUp = el usuario suelta un botón (más confiable que keyDown para acciones)
sd.on('keyUp', async ({ action }) => {
  if (!action) return;

  const controlMap: Record<string, ControlAction> = {
    'dev.camiloseguro.musicdeck.playpause': 'togglePlay',
    'dev.camiloseguro.musicdeck.next':      'next',
    'dev.camiloseguro.musicdeck.previous':  'previous',
  };

  const ctrl = controlMap[action];
  if (ctrl) await mediaManager.control(ctrl);
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

console.log('[MusicDeck] iniciando...');
mediaManager.start(500);
sd.connect();
