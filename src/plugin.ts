/**
 * plugin.ts — Music Deck para StreamDock (HotSpot)
 *
 * Acciones disponibles:
 *   albumart.q0/q1/q2/q3  → portada dividida en 4 botones (2×2)
 *   playpause / next / previous → controles
 *   title / artist / duration   → info de la canción
 *   lyrics                      → letra sincronizada (anterior / actual / siguiente)
 *   lyricsbar                   → letra en la barra de los 4 knobs; los knobs controlan:
 *                                   presionar → play/pausa
 *                                   girar knob 0–1 → adelantar/atrasar
 *                                   girar knob 2–3 → volumen
 *   visualizer                  → barras con el espectro real del audio (Windows)
 */

import { sd }           from './streamdock';
import { mediaManager } from './providers/media-manager';
import { log }          from './log';
import { applySettings, getSettings } from './settings';
import { renderKey, renderSignature, type BarOverlay, type RenderExtras } from './ui/canvas-renderer';
import { fetchLyrics }  from './lyrics/lrclib';
import { currentLyricIndex, lineProgress, lyricsWindow } from './lyrics/sync';
import { createVisualizer, updateVisualizer, updateVisualizerFromSpectrum } from './ui/visualizer';
import type { ControlAction, LyricLine, MediaInfo } from './types';

const ID = 'dev.camiloseguro.musicdeck.';

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

/** Aviso en la barra de knobs (seek/volumen) y hasta cuándo se muestra */
let overlay: BarOverlay | null = null;
let overlayUntil = 0;
const OVERLAY_MS = 1_200;

// ─── Letras ───────────────────────────────────────────────────────────────────

function isLyricsAction(actionId: string): boolean {
  return /\.lyrics(bar)?$/.test(actionId);
}

function hasAction(suffix: string): boolean {
  for (const k of keys.values()) if (k.actionId === `${ID}${suffix}`) return true;
  return false;
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
  // Adelanto configurable: compensa lo que tarda la imagen en llegar a la pantalla
  const pos = (media?.position ?? 0) + getSettings().lyricsOffsetMs / 1000;
  const idx = currentLyricIndex(lyrics, pos);
  if (overlay && Date.now() > overlayUntil) overlay = null;
  return {
    lyrics: {
      status:   lyricsStatus,
      index:    idx,
      window:   lyricsWindow(lyrics, pos),
      progress: lineProgress(lyrics, idx, pos),
    },
    bars: viz.bars,
    overlay,
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

// ─── Loop de render (100 ms) ──────────────────────────────────────────────────
// Rápido para que la letra cambie a tiempo y el karaoke/visualizador se vean
// fluidos; solo se redibujan los botones cuya firma cambió.

let _tick     = 0;
let rendering = false;

setInterval(async () => {
  if (rendering) return;   // el tick anterior aún no termina → saltar
  rendering = true;
  try {
    const media = mediaManager.getCurrent();
    _tick++;
    if (_tick % 600 === 1) {   // cada ~60 s
      log(`tick media=${media ? `"${media.title}" playing=${String(media.isPlaying)}` : 'null'} keys=${keys.size}`);
    }

    syncLyrics(media);
    const spectrum = mediaManager.getSpectrum();
    viz = spectrum && media?.isPlaying !== false
      ? updateVisualizerFromSpectrum(viz, spectrum)
      : updateVisualizer(viz, media?.isPlaying ?? false);
    const extras = buildExtras(media);

    await Promise.all([...keys].map(([ctx, state]) => renderOne(ctx, state, media, extras)));
  } finally {
    rendering = false;
  }
}, 100);

/** Captura de audio solo mientras haya un visualizador en pantalla. */
function updateSpectrum(): void {
  mediaManager.setSpectrum(hasAction('visualizer'));
}

// ─── Knobs ────────────────────────────────────────────────────────────────────

// Los clics de un giro rápido se juntan en un solo comando (SMTC no da abasto con
// uno por clic y la canción saltaría a tirones).
const DIAL_BATCH_MS = 150;
let seekTicks = 0;
let volTicks  = 0;
let dialTimer: ReturnType<typeof setTimeout> | null = null;

function onDialRotate(column: number, ticks: number): void {
  if (column <= 1) seekTicks += ticks;
  else             volTicks  += ticks;
  if (!dialTimer) dialTimer = setTimeout(flushDial, DIAL_BATCH_MS);
}

function flushDial(): void {
  dialTimer = null;
  const s = getSettings();

  if (seekTicks !== 0) {
    const seconds = seekTicks * s.seekStep;
    seekTicks = 0;
    // Se acumula mientras el aviso sigue visible: "Adelantar +15 s" al girar 3 clics
    const prev = overlay?.kind === 'seek' && Date.now() < overlayUntil ? overlay.seconds : 0;
    showOverlay({ kind: 'seek', seconds: prev + seconds });
    void mediaManager.seekBy(seconds);
  }

  if (volTicks !== 0) {
    const delta = (volTicks * s.volumeStep) / 100;
    volTicks = 0;
    void mediaManager.volumeBy(delta).then((level) => {
      if (level !== null) showOverlay({ kind: 'volume', level });
    });
  }
}

function showOverlay(o: BarOverlay): void {
  overlay      = o;
  overlayUntil = Date.now() + OVERLAY_MS;
}

// ─── Eventos StreamDock ───────────────────────────────────────────────────────

sd.on('connected', () => sd.getGlobalSettings());

sd.on('didReceiveGlobalSettings', ({ payload }) => {
  const settings = applySettings(payload?.['settings']);
  log(`ajustes: ${JSON.stringify(settings)}`);
});

// El Property Inspector también manda los ajustes directo (por si el software no
// reenvía didReceiveGlobalSettings al plugin cuando el PI los guarda)
sd.on('sendToPlugin', ({ payload }) => {
  if (payload?.['type'] === 'settings') applySettings(payload['settings']);
});

sd.on('willAppear', async ({ action, context, payload }) => {
  if (!context || !action) return;
  log(`willAppear action=${action} ctx=${context} payload=${JSON.stringify(payload ?? {})}`);
  const coords = payload?.['coordinates'] as { column?: number } | undefined;
  const state: KeyState = { actionId: action, column: coords?.column ?? 0, lastSig: '' };
  keys.set(context, state);
  updateSpectrum();
  // Un botón de letra nuevo → buscar letra de la canción actual si no se había buscado
  if (isLyricsAction(action) && lyricsStatus === 'none' && lyricsTries === 0) lyricsFor = '';
  const media = mediaManager.getCurrent();
  syncLyrics(media);
  await renderOne(context, state, media, buildExtras(media));
});

sd.on('willDisappear', ({ context }) => {
  if (!context) return;
  keys.delete(context);
  updateSpectrum();
  log(`willDisappear ctx=${context}`);
});

sd.on('keyUp', async ({ action }) => {
  if (!action) return;

  const controlMap: Record<string, ControlAction> = {
    [`${ID}playpause`]: 'togglePlay',
    [`${ID}next`]:      'next',
    [`${ID}previous`]:  'previous',
  };

  const ctrl = controlMap[action];
  if (ctrl) await mediaManager.control(ctrl);
});

sd.on('dialDown', async ({ action }) => {
  if (action === `${ID}lyricsbar`) await mediaManager.control('togglePlay');
});

sd.on('dialRotate', ({ action, context, payload }) => {
  if (action !== `${ID}lyricsbar` || !context) return;
  const ticks = Number(payload?.['ticks'] ?? 0);
  const state = keys.get(context);
  if (state && ticks) onDialRotate(state.column, ticks);
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

console.log('[MusicDeck] iniciando...');
mediaManager.start(500);
sd.connect();
