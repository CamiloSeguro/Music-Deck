/**
 * plugin.ts — Music Deck para StreamDock (HotSpot)
 *
 * Acciones disponibles:
 *   albumart.q0/q1/q2/q3  → portada dividida en 4 botones (2×2)
 *   playpause / next / previous → controles
 *   title / artist / duration   → info de la canción
 */

import { sd }           from './streamdock';
import { mediaManager } from './providers/media-manager';
import { appendFileSync } from 'fs';
import { join }           from 'path';
import { renderKey }      from './ui/canvas-renderer';
import type { ControlAction } from './types';

const DEBUG_LOG = join(__dirname, '..', 'debug.log');
function dbg(msg: string): void {
  try { appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* noop */ }
}

// ─── Estado ───────────────────────────────────────────────────────────────────

/** context → actionId */
const keyContexts = new Map<string, string>();

// ─── Loop de render (250 ms) ──────────────────────────────────────────────────

let _tick = 0;
setInterval(async () => {
  const media = mediaManager.getCurrent();
  _tick++;
  if (_tick % 20 === 1) {
    dbg(`tick media=${media ? `"${media.title}" playing=${String(media.isPlaying)}` : 'null'} keys=${keyContexts.size}`);
  }

  for (const [ctx, actionId] of keyContexts) {
    try {
      const img = await renderKey(actionId, media);
      sd.setImage(ctx, img);
    } catch (err) {
      console.error('[render]', err);
    }
  }
}, 250);

// ─── Eventos StreamDock ───────────────────────────────────────────────────────

sd.on('willAppear', async ({ action, context }) => {
  if (!context || !action) return;
  dbg(`willAppear action=${action} ctx=${context}`);
  keyContexts.set(context, action);
  try {
    const img = await renderKey(action, mediaManager.getCurrent());
    sd.setImage(context, img);
  } catch (err) {
    console.error('[willAppear render]', err);
  }
});

sd.on('willDisappear', ({ context }) => {
  if (!context) return;
  keyContexts.delete(context);
  dbg(`willDisappear ctx=${context}`);
});

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
