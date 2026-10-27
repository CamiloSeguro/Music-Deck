/**
 * plugin.ts — Music Deck para StreamDock (HotSpot)
 *
 * Acciones disponibles:
 *   albumart.q0/q1/q2/q3  → portada dividida en 4 botones (2×2)
 *   playpause / next / previous → controles
 *   title / artist / duration   → info de la canción
 *   lyrics                      → letra sincronizada (anterior / actual / siguiente)
 *   visualizer                  → barras animadas
 */

import { sd }           from './streamdock';
import { mediaManager } from './providers/media-manager';
import { log }          from './log';
import { renderKey, renderSignature, type RenderExtras } from './ui/canvas-renderer';
import { fetchLyrics }  from './lyrics/lrclib';
import { currentLyricIndex, lyricsWindow } from './lyrics/sync';
import { createVisualizer, updateVisualizer } from './ui/visualizer';
import type { ControlAction, LyricLine, MediaInfo } from './types';

// ─── Estado ───────────────────────────────────────────────────────────────────

interface KeyState {
  actionId: string;
  /** Columna en el dispositivo (la barra de letra la usa para saber qué segmento dibujar) */
  column:   number;
  /** Firma de la última imagen enviada ('' = forzar render) */
  lastSig:  string;
}

/** context → estado del botón */
const keys = new Map<string, KeyState>();

let viz = createVisualizer();

let lyrics: LyricLine[] = [];
let lyricsStatus: RenderExtras['lyrics']['status'] = 'none';
let lyricsFor = '';   // "title|artist" de la letra cargada (o en búsqueda)
let lyricsTries = 0;  // búsquedas sin resultado para la canción actual
let lyricsRetryAt = 0;

const LYRICS_MAX_TRIES   = 3;
const LYRICS_RETRY_MS    = 20_000;

// ─── Letras ───────────────────────────────────────────────────────────────────

function isLyricsAction(actionId: string): boolean {
  return /\.lyrics(bar)?$/.test(actionId);
}

function needsLyrics(): boolean {
  for (const k of keys.values()) if (isLyricsAction(k.actionId)) return true;
  return false;
}

function syncLyrics(media: MediaInfo | null): void {
  const key = media ? `${media.title}|${media.artist}` : '';
  if (key !== lyricsFor) {
    lyricsFor   = key;
    lyrics      = [];
    lyricsTries = 0;
    if (!media || !media.title || !needsLyrics()) { lyricsStatus = 'none'; return; }
  } else {
    // Misma canción: reintentar solo si la búsqueda anterior no encontró nada
    const retry = media && lyricsStatus === 'none' && lyricsTries > 0
      && lyricsTries < LYRICS_MAX_TRIES && Date.now() >= lyricsRetryAt && needsLyrics();
    if (!retry) return;
  }

  lyricsStatus = 'loading';
  void fetchLyrics(media!.title, media!.artist, media!.album, media!.duration).then((lines) => {
    if (lyricsFor !== key) return;   // cambió la canción mientras buscábamos
    lyrics       = lines;
    lyricsStatus = lines.length > 0 ? 'ok' : 'none';
    if (lines.length === 0) {
      lyricsTries++;
      lyricsRetryAt = Date.now() + LYRICS_RETRY_MS;
    }
  });
}

function buildExtras(media: MediaInfo | null): RenderExtras {
  const pos = media?.position ?? 0;
  return {
    lyrics: {
      status: lyricsStatus,
      index:  currentLyricIndex(lyrics, pos),
      window: lyricsWindow(lyrics, pos),
    },
    bars: viz.bars,
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────

async function renderOne(ctx: string, state: KeyState, media: MediaInfo | null, extras: RenderExtras): Promise<void> {
  const sig = renderSignature(state.actionId, media, extras);
  if (sig === state.lastSig) return;   // nada cambió → no renderizar ni reenviar
  try {
    const img = await renderKey(state.actionId, media, extras, state.column);
    // El botón pudo desaparecer mientras renderizábamos
    if (keys.get(ctx) !== state) return;
    sd.setImage(ctx, img);
    state.lastSig = sig;
  } catch (err) {
    log(`[render] ${state.actionId}: ${String(err)}`);
  }
}

// ─── Loop de render (250 ms) ──────────────────────────────────────────────────

let _tick     = 0;
let rendering = false;

setInterval(async () => {
  if (rendering) return;   // el tick anterior aún no termina → saltar
  rendering = true;
  try {
    const media = mediaManager.getCurrent();
    _tick++;
    if (_tick % 240 === 1) {   // cada ~60 s
      log(`tick media=${media ? `"${media.title}" playing=${String(media.isPlaying)}` : 'null'} keys=${keys.size}`);
    }

    syncLyrics(media);
    viz = updateVisualizer(viz, media?.isPlaying ?? false);
    const extras = buildExtras(media);

    await Promise.all([...keys].map(([ctx, state]) => renderOne(ctx, state, media, extras)));
  } finally {
    rendering = false;
  }
}, 250);

// ─── Eventos StreamDock ───────────────────────────────────────────────────────

sd.on('willAppear', async ({ action, context, payload }) => {
  if (!context || !action) return;
  log(`willAppear action=${action} ctx=${context} payload=${JSON.stringify(payload ?? {})}`);
  const coords = payload?.['coordinates'] as { column?: number } | undefined;
  const state: KeyState = { actionId: action, column: coords?.column ?? 0, lastSig: '' };
  keys.set(context, state);
  // Un botón de letra nuevo → buscar letra de la canción actual si no se había buscado
  if (isLyricsAction(action) && lyricsStatus === 'none' && lyricsTries === 0) lyricsFor = '';
  const media = mediaManager.getCurrent();
  syncLyrics(media);
  await renderOne(context, state, media, buildExtras(media));
});

sd.on('willDisappear', ({ context }) => {
  if (!context) return;
  keys.delete(context);
  log(`willDisappear ctx=${context}`);
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
