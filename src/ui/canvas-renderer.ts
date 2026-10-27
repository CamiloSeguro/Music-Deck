/**
 * canvas-renderer.ts
 * Genera imágenes PNG 144×144 para cada tipo de botón de Music Deck.
 *
 *  renderAlbumArtKey(quadrant, media) → portada recortada (cuadrante 0-3)
 *  renderControlKey(actionId, media)  → play/pause, next, previous
 *  renderTitleKey(media)              → título de la canción
 *  renderArtistKey(media)             → artista
 *  renderDurationKey(media)           → posición / duración
 *  renderLyricsKey(media, lyrics)     → línea anterior / actual / siguiente
 *  renderVisualizerKey(bars)          → barras animadas
 *
 *  renderSignature() resume lo que muestra cada botón: si no cambia, no hace
 *  falta volver a renderizarlo ni reenviarlo al StreamDock.
 */
import { createCanvas, loadImage, type Canvas, type Image } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { MediaInfo } from '../types';
import type { LyricsWindow } from '../lyrics/sync';
import { getSettings, settingsVersion } from '../settings';
import { pickAccent } from './accent';
import { karaokeFill, partitionWords } from './segment-layout';

const ID = 'dev.camiloseguro.musicdeck.';

/** Aviso temporal en la barra de knobs al girarlos. */
export type BarOverlay =
  | { kind: 'seek';   seconds: number }
  | { kind: 'volume'; level: number };

/** Datos extra (fuera de MediaInfo) que necesitan algunos botones. */
export interface RenderExtras {
  /** Letra de la canción actual: buscando, no encontrada, o línea activa (+ avance del karaoke 0–1) */
  lyrics:     { status: 'loading' | 'none' | 'ok'; index: number; window: LyricsWindow; progress: number };
  /** Alturas 0–1 del visualizador */
  bars:       number[];
  /** Aviso a mostrar en la barra de knobs en lugar de la letra */
  overlay:    BarOverlay | null;
}

const KW = 144;
const KH = 144;

const C = {
  bg:      '#111111',
  /** Color de acento: el de la portada o el fijo, según los ajustes */
  get accent(): string { return accentNow(); },
  text:    '#ffffff',
  dim:     '#aaaaaa',
  dimDark: '#555555',
  label:   '#666666',
  progBg:  '#2a2a2a',
};

const DEFAULT_ACCENT = '#e03030';
let coverAccent: string | null = null;   // calculado al decodificar cada portada

function accentNow(): string {
  const s = getSettings();
  if (s.accentMode === 'fixed') return s.accentColor;
  return coverAccent ?? DEFAULT_ACCENT;
}

type Ctx = SKRSContext2D;

// ─── Dispatcher central ───────────────────────────────────────────────────────

export async function renderKey(
  actionId: string,
  media:    MediaInfo | null,
  extras:   RenderExtras,
  /** Columna del botón/knob (para acciones repartidas en varios knobs) */
  column = 0,
): Promise<string> {
  if (actionId.startsWith(`${ID}albumart.`)) {
    const q = parseInt(actionId.slice(-1), 10) as 0 | 1 | 2 | 3;
    return renderAlbumArtKey(q, media);
  }
  if (actionId === `${ID}title`)      return renderTitleKey(media);
  if (actionId === `${ID}artist`)     return renderArtistKey(media);
  if (actionId === `${ID}duration`)   return renderDurationKey(media);
  if (actionId === `${ID}lyrics`)     return renderLyricsKey(media, extras.lyrics);
  if (actionId === `${ID}lyricsbar`)  return renderLyricsBarSegment(column, media, extras);
  if (actionId === `${ID}visualizer`) return renderVisualizerKey(extras.bars);
  return renderControlKey(actionId, media);
}

/** Resumen de lo que dibuja un botón; misma firma ⇒ misma imagen. */
export function renderSignature(
  actionId: string,
  media:    MediaInfo | null,
  extras:   RenderExtras,
): string {
  const thumb = thumbId(media);
  if (actionId.startsWith(`${ID}albumart.`)) return `art|${thumb}`;
  // El resto usa el color de acento y los ajustes: si cambian, hay que redibujar
  return `${accentNow()}|${settingsVersion()}|${contentSignature(actionId, media, extras, thumb)}`;
}

function contentSignature(actionId: string, media: MediaInfo | null, extras: RenderExtras, thumb: number): string {
  if (actionId === `${ID}lyricsbar`)  return `lb|${barSignature(media, extras)}`;
  if (actionId === `${ID}visualizer`) return `v|${extras.bars.map(b => Math.round(b * 60)).join(',')}`;
  if (!media) return 'empty';
  switch (actionId) {
    case `${ID}title`:      return `t|${media.title}`;
    case `${ID}artist`:     return `a|${media.artist}|${media.album}`;
    case `${ID}duration`:   return `d|${Math.floor(media.position)}|${Math.floor(media.duration)}`;
    case `${ID}lyrics`:     return `l|${media.title}|${extras.lyrics.status}|${extras.lyrics.index}`;
    default:                return `c|${String(media.isPlaying)}|${media.title}|${media.artist}|${thumb}`;
  }
}

// ─── Cache de la portada decodificada ─────────────────────────────────────────

let cachedThumb:  string | null = null;
let cachedId    = 0;
let cachedImage: Promise<Image | null> = Promise.resolve(null);

/** Id que cambia solo cuando cambia la portada (comparar el base64 es barato si no cambió). */
function thumbId(media: MediaInfo | null): number {
  const thumb = media?.thumbnailBase64 ?? null;
  if (thumb !== cachedThumb) {
    cachedThumb = thumb;
    cachedId++;
    coverAccent = null;
    const id    = cachedId;
    cachedImage = thumb
      ? loadImage(Buffer.from(thumb, 'base64')).catch(() => null)
      : Promise.resolve(null);
    // Acento de la portada: se calcula una vez por portada, en segundo plano
    void cachedImage.then((img) => {
      if (img && id === cachedId) coverAccent = accentFromImage(img);
    });
  }
  return cachedId;
}

/** Reduce la portada a 32×32 y elige su color más vivo dominante. */
function accentFromImage(img: Image): string | null {
  const small = createCanvas(32, 32);
  const ctx   = small.getContext('2d');
  ctx.drawImage(img, 0, 0, 32, 32);
  return pickAccent(ctx.getImageData(0, 0, 32, 32).data);
}

/** Portada decodificada una sola vez por canción (antes se decodificaba ~28 veces/s). */
function getArt(media: MediaInfo | null): Promise<Image | null> {
  thumbId(media);
  return cachedImage;
}

// ─── Portada (cuadrante) ──────────────────────────────────────────────────────

/**
 * Quadrant layout (la imagen completa mide 288×288 sobre 4 botones):
 *   0 = top-left     1 = top-right
 *   2 = bottom-left  3 = bottom-right
 */
export async function renderAlbumArtKey(
  quadrant: 0 | 1 | 2 | 3,
  media: MediaInfo | null,
): Promise<string> {
  const canvas = createCanvas(KW, KH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, KW, KH);

  const img = await getArt(media);
  if (!img) {
    drawNoArtPlaceholder(ctx, quadrant);
    return toDataUrl(canvas);
  }

  // Dibujamos la imagen completa a 288×288 y usamos el offset del cuadrante
  const ox = (quadrant === 1 || quadrant === 3) ? -KW : 0;
  const oy = (quadrant === 2 || quadrant === 3) ? -KH : 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, KW, KH);
  ctx.clip();
  ctx.drawImage(img, ox, oy, KW * 2, KH * 2);
  ctx.restore();

  return toDataUrl(canvas);
}

function drawNoArtPlaceholder(ctx: Ctx, quadrant: number): void {
  // Fondo oscuro con gradiente sutil
  const grad = ctx.createLinearGradient(0, 0, KW, KH);
  grad.addColorStop(0, '#1a1a1a');
  grad.addColorStop(1, '#0d0d0d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, KW, KH);

  // Solo en el cuadrante 3 (abajo-der) mostramos el ícono para no repetirlo 4x
  if (quadrant === 3) {
    ctx.fillStyle    = C.dimDark;
    ctx.font         = '48px Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♪', KW / 2, KH / 2);
  }
}

// ─── Controles (play/pause, next, previous) ───────────────────────────────────

export async function renderControlKey(
  actionId: string,
  media:    MediaInfo | null,
): Promise<string> {
  const canvas = createCanvas(KW, KH);
  const ctx    = canvas.getContext('2d');

  const isPlay = actionId === 'dev.camiloseguro.musicdeck.playpause';
  const isNext = actionId === 'dev.camiloseguro.musicdeck.next';
  const isPrev = actionId === 'dev.camiloseguro.musicdeck.previous';
  const playing = media?.isPlaying ?? false;

  // Fondo
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, KW, KH);

  // Portada de fondo con opacidad baja
  const art = await getArt(media);
  if (art) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.drawImage(art, 0, 0, KW, KH);
    ctx.restore();
  }

  // Overlay oscuro
  const grad = ctx.createLinearGradient(0, 0, 0, KH);
  grad.addColorStop(0,   'rgba(0,0,0,0.6)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1,   'rgba(0,0,0,0.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, KW, KH);

  // Línea de acento arriba
  ctx.fillStyle = playing && isPlay ? C.accent : '#333';
  ctx.fillRect(0, 0, KW, 3);

  // Círculo de fondo del símbolo
  const cx = KW / 2;
  const cy = KH / 2 - 8;
  const R  = 30;

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = isPlay && playing ? C.accent : 'rgba(255,255,255,0.10)';
  ctx.fill();

  // Símbolo
  ctx.fillStyle = isPlay && playing ? '#000' : C.accent;

  if (isPlay) {
    if (playing) {
      const bw = 7, bh = 22, gap = 7;
      ctx.fillRect(cx - gap / 2 - bw, cy - bh / 2, bw, bh);
      ctx.fillRect(cx + gap / 2,      cy - bh / 2, bw, bh);
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 15);
      ctx.lineTo(cx + 17, cy);
      ctx.lineTo(cx - 10, cy + 15);
      ctx.closePath();
      ctx.fill();
    }
  } else if (isNext) {
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy - 13); ctx.lineTo(cx - 2, cy); ctx.lineTo(cx - 15, cy + 13);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 2, cy - 13); ctx.lineTo(cx + 11, cy); ctx.lineTo(cx - 2, cy + 13);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(cx + 11, cy - 13, 4, 26);
  } else if (isPrev) {
    ctx.fillRect(cx - 15, cy - 13, 4, 26);
    ctx.beginPath();
    ctx.moveTo(cx + 15, cy - 13); ctx.lineTo(cx + 2, cy); ctx.lineTo(cx + 15, cy + 13);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 2, cy - 13); ctx.lineTo(cx - 11, cy); ctx.lineTo(cx + 2, cy + 13);
    ctx.closePath(); ctx.fill();
  }

  // Título y artista en la parte inferior
  if (media?.title) {
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle    = 'rgba(255,255,255,0.9)';
    ctx.font         = 'bold 12px Arial';
    ctx.fillText(clip(media.title, 16), KW / 2, KH - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.font      = '10px Arial';
    ctx.fillText(clip(media.artist, 20), KW / 2, KH - 4);
  } else {
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle    = C.dimDark;
    ctx.font         = '10px Arial';
    ctx.fillText('Sin media', KW / 2, KH - 6);
  }

  return toDataUrl(canvas);
}

// ─── Título ───────────────────────────────────────────────────────────────────

export async function renderTitleKey(media: MediaInfo | null): Promise<string> {
  const canvas = createCanvas(KW, KH);
  const ctx    = canvas.getContext('2d');

  drawInfoBackground(ctx);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';

  // Etiqueta
  ctx.fillStyle = C.label;
  ctx.font      = '10px Arial';
  ctx.fillText('TÍTULO', KW / 2, 10);

  // Línea de acento
  ctx.fillStyle = C.accent;
  ctx.fillRect(KW / 2 - 16, 22, 32, 2);

  if (media?.title) {
    ctx.fillStyle = C.text;
    drawCenteredText(ctx, media.title, KW / 2, 34, KW - 16, 15, 'bold', 3, KH - 20);
  } else {
    ctx.fillStyle = C.dimDark;
    ctx.font      = '12px Arial';
    ctx.fillText('—', KW / 2, 38);
  }

  return toDataUrl(canvas);
}

// ─── Artista ──────────────────────────────────────────────────────────────────

export async function renderArtistKey(media: MediaInfo | null): Promise<string> {
  const canvas = createCanvas(KW, KH);
  const ctx    = canvas.getContext('2d');

  drawInfoBackground(ctx);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';

  // Etiqueta
  ctx.fillStyle = C.label;
  ctx.font      = '10px Arial';
  ctx.fillText('ARTISTA', KW / 2, 10);

  // Línea de acento
  ctx.fillStyle = C.accent;
  ctx.fillRect(KW / 2 - 16, 22, 32, 2);

  if (media?.artist) {
    ctx.fillStyle = C.dim;
    drawCenteredText(ctx, media.artist, KW / 2, 34, KW - 16, 14, 'normal', 3, KH - 20);
  } else {
    ctx.fillStyle = C.dimDark;
    ctx.font      = '12px Arial';
    ctx.fillText('—', KW / 2, 38);
  }

  // Álbum si hay
  if (media?.album) {
    ctx.fillStyle    = C.dimDark;
    ctx.font         = '10px Arial';
    ctx.textBaseline = 'bottom';
    ctx.fillText(clip(media.album, 20), KW / 2, KH - 10);
  }

  return toDataUrl(canvas);
}

// ─── Duración ─────────────────────────────────────────────────────────────────

export async function renderDurationKey(media: MediaInfo | null): Promise<string> {
  const canvas = createCanvas(KW, KH);
  const ctx    = canvas.getContext('2d');

  drawInfoBackground(ctx);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';

  // Etiqueta
  ctx.fillStyle = C.label;
  ctx.font      = '10px Arial';
  ctx.fillText('DURACIÓN', KW / 2, 10);

  if (media && media.duration > 0) {
    const pct = Math.min(1, media.position / media.duration);

    // Tiempo actual grande
    ctx.fillStyle    = C.text;
    ctx.font         = 'bold 28px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(media.position), KW / 2, KH / 2 - 10);

    // Total más pequeño
    ctx.fillStyle = C.dim;
    ctx.font      = '13px Arial';
    ctx.fillText(`/ ${fmt(media.duration)}`, KW / 2, KH / 2 + 20);

    // Barra de progreso
    const barX = 12, barY = KH - 24, barW = KW - 24, barH = 4;
    ctx.fillStyle = C.progBg;
    rrect(ctx, barX, barY, barW, barH, 2);
    ctx.fill();

    ctx.fillStyle = C.accent;
    if (pct > 0) {
      rrect(ctx, barX, barY, Math.max(barH, barW * pct), barH, 2);
      ctx.fill();
    }

    // Tiempos bajo la barra
    ctx.font         = '9px Arial';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = C.dimDark;
    ctx.textAlign    = 'left';
    ctx.fillText(fmt(media.position), barX, KH - 14);
    ctx.textAlign = 'right';
    ctx.fillText(fmt(media.duration), barX + barW, KH - 14);
    ctx.textAlign = 'center';

  } else {
    ctx.fillStyle    = C.dimDark;
    ctx.font         = '22px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillText('—:——', KW / 2, KH / 2);
  }

  return toDataUrl(canvas);
}

// ─── Letra ────────────────────────────────────────────────────────────────────

export async function renderLyricsKey(
  media:  MediaInfo | null,
  lyrics: RenderExtras['lyrics'],
): Promise<string> {
  const canvas = createCanvas(KW, KH);
  const ctx    = canvas.getContext('2d');

  drawInfoBackground(ctx);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = C.label;
  ctx.font         = '10px Arial';
  ctx.fillText('LETRA', KW / 2, 8);

  ctx.fillStyle = C.accent;
  ctx.fillRect(KW / 2 - 16, 20, 32, 2);

  const { status, window: w } = lyrics;

  if (!media || status !== 'ok') {
    const msg = !media ? '—' : status === 'loading' ? 'Buscando…' : 'Sin letra';
    ctx.fillStyle    = C.dimDark;
    ctx.font         = '12px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, KW / 2, KH / 2 + 6);
    return toDataUrl(canvas);
  }

  // Anterior (arriba, tenue) · actual (centro, grande) · siguiente (abajo, tenue)
  ctx.fillStyle = C.dimDark;
  ctx.font      = '10px Arial';
  if (w.previous) ctx.fillText(fitWidth(ctx, w.previous, KW - 12), KW / 2, 28);

  ctx.fillStyle = w.current ? C.text : C.dimDark;
  drawCenteredText(ctx, w.current || '♪', KW / 2, 40, KW - 12, 15, 'bold', 3, KH - 22);

  ctx.fillStyle    = C.dim;
  ctx.font         = '10px Arial';
  ctx.textBaseline = 'bottom';
  if (w.next) ctx.fillText(fitWidth(ctx, w.next, KW - 12), KW / 2, KH - 8);

  return toDataUrl(canvas);
}

// ─── Letra en la barra de knobs ───────────────────────────────────────────────

/**
 * La pantalla sobre los 4 knobs del N4 Pro: cada knob muestra un segmento de
 * SEG_W×SEG_H. Se dibuja la barra completa una vez y cada knob recorta su parte
 * (igual que la portada repartida en 4 botones).
 */
const SEG_W    = 200;
const SEG_H    = 100;
const SEGMENTS = 4;
const BAR_W    = SEG_W * SEGMENTS;

/** Escala del texto de la barra según el ajuste lyricsSize */
const SIZE_SCALE = { small: 0.8, medium: 1, large: 1.2 } as const;

let barCache: { sig: string; canvas: Canvas } | null = null;

/** Firma de la barra completa (la comparten los 4 knobs). */
function barSignature(media: MediaInfo | null, extras: RenderExtras): string {
  const { lyrics, overlay } = extras;
  const s = getSettings();
  // El karaoke avanza en pasos de 1/40 de línea: suficiente para verse fluido
  const step = s.karaoke && lyrics.status === 'ok' ? Math.floor(lyrics.progress * 40) : 0;
  const ov   = overlay ? `${overlay.kind}:${overlay.kind === 'volume' ? Math.round(overlay.level * 100) : overlay.seconds}` : '';
  return `${media?.title ?? ''}|${media?.artist ?? ''}|${lyrics.status}|${lyrics.index}|${step}|${ov}|${accentNow()}|${settingsVersion()}`;
}

export async function renderLyricsBarSegment(
  column: number,
  media:  MediaInfo | null,
  extras: RenderExtras,
): Promise<string> {
  const sig = barSignature(media, extras);
  if (barCache?.sig !== sig) barCache = { sig, canvas: drawLyricsBar(media, extras) };

  const seg = createCanvas(SEG_W, SEG_H);
  const col = ((column % SEGMENTS) + SEGMENTS) % SEGMENTS;
  seg.getContext('2d').drawImage(barCache.canvas, -col * SEG_W, 0);
  return toDataUrl(seg);
}

function drawLyricsBar(media: MediaInfo | null, extras: RenderExtras): Canvas {
  const canvas = createCanvas(BAR_W, SEG_H);
  const ctx    = canvas.getContext('2d');
  const { lyrics, overlay } = extras;
  const s      = getSettings();
  const scale  = SIZE_SCALE[s.lyricsSize];

  const grad = ctx.createLinearGradient(0, 0, 0, SEG_H);
  grad.addColorStop(0, '#1a1a1a');
  grad.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BAR_W, SEG_H);

  if (overlay) {
    drawBarOverlay(ctx, overlay);
    return canvas;
  }

  if (!media || lyrics.status !== 'ok') {
    // Sin letra: mostrar qué suena, en tenue
    ctx.fillStyle = C.dimDark;
    const msg = !media ? '—'
      : lyrics.status === 'loading' ? 'Buscando letra…'
      : `♪ ${media.title} — ${media.artist}`;
    drawSegmentedText(ctx, msg, 'normal', Math.round(24 * scale), 12, 6, SEG_H - 6, 2);
    return canvas;
  }

  const { current, next } = lyrics.window;
  const withNext = s.showNextLine && !!next;

  // Línea actual: grande; si no cabe en una fila, baja de tamaño y usa 2 filas.
  // Con karaoke: blanca, y lo ya cantado en el color de acento.
  ctx.fillStyle = current ? C.text : C.dimDark;
  drawSegmentedText(
    ctx, current || '♪', 'bold', Math.round(32 * scale), 13, 4, withNext ? 74 : SEG_H - 4, 2,
    s.karaoke && current ? { progress: lyrics.progress, color: C.accent } : undefined,
  );

  // Siguiente línea: pequeña y tenue, abajo, en una sola fila
  if (withNext) {
    ctx.fillStyle = C.dim;
    drawSegmentedText(ctx, next, 'normal', Math.round(15 * scale), 11, 76, SEG_H - 4, 1);
  }

  return canvas;
}

/** Aviso temporal al girar un knob: segundos adelantados/atrasados o el volumen. */
function drawBarOverlay(ctx: Ctx, overlay: BarOverlay): void {
  if (overlay.kind === 'seek') {
    const sign = overlay.seconds >= 0 ? '+' : '−';
    ctx.fillStyle = C.text;
    drawSegmentedText(ctx, `${overlay.seconds >= 0 ? 'Adelantar' : 'Atrasar'} ${sign}${Math.abs(overlay.seconds)} s`,
      'bold', 30, 14, 10, SEG_H - 10, 1);
    return;
  }

  // Volumen: texto arriba y una barra de nivel a lo ancho de los 4 knobs
  const pct = Math.round(overlay.level * 100);
  ctx.fillStyle = C.text;
  drawSegmentedText(ctx, `Volumen ${pct}%`, 'bold', 28, 14, 8, 56, 1);

  const x = SEG_PAD, y = 68, w = BAR_W - SEG_PAD * 2, h = 12;
  ctx.fillStyle = C.progBg;
  rrect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (pct > 0) {
    ctx.fillStyle = C.accent;
    rrect(ctx, x, y, Math.max(h, w * overlay.level), h, h / 2);
    ctx.fill();
  }
}

// ─── Texto repartido entre los knobs ──────────────────────────────────────────

/** Margen interno de cada pantalla, para que el texto no toque el borde físico. */
const SEG_PAD = 8;

/**
 * Dibuja texto en la barra sin que ninguna palabra quede partida entre dos
 * pantallas: reparte las palabras en grupos (uno por pantalla y fila) y centra
 * cada grupo en su pantalla. Se lee de izquierda a derecha, fila por fila.
 *
 * Intenta, de mayor a menor tamaño de fuente: 1 fila en las 2 pantallas del
 * centro, 1 fila en las 4, y (si maxRows = 2) 2 filas en las 4. Si ni con la
 * fuente mínima cabe, recorta el último grupo con "…".
 *
 * Con `karaoke`, lo ya cantado (progress 0–1, en orden de lectura) se pinta
 * encima en `color`.
 */
function drawSegmentedText(
  ctx: Ctx, text: string, weight: 'bold' | 'normal',
  maxSize: number, minSize: number,
  top: number, bottom: number, maxRows: 1 | 2,
  karaoke?: { progress: number; color: string },
): void {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return;
  const innerW  = SEG_W - SEG_PAD * 2;
  const measure = (t: string) => ctx.measureText(t).width;

  type Layout = { size: number; rows: number; segs: number[]; groups: string[] };
  let layout: Layout | null = null;

  const tryLayout = (size: number, rows: number, segs: number[]): Layout | null => {
    if (rows * (size + 4) > bottom - top) return null;
    ctx.font = `${weight} ${size}px Arial`;
    const groups = partitionWords(words, rows * segs.length, measure);
    return groups.every(g => measure(g) <= innerW) ? { size, rows, segs, groups } : null;
  };

  for (let size = maxSize; size >= minSize && !layout; size--) {
    layout = tryLayout(size, 1, [1, 2]) ?? tryLayout(size, 1, [0, 1, 2, 3]);
  }
  if (maxRows === 2) {
    for (let size = Math.min(maxSize, 24); size >= minSize && !layout; size--) {
      layout = tryLayout(size, 2, [0, 1, 2, 3]);
    }
  }
  if (!layout) {
    // No cabe ni al mínimo: llenar las pantallas en orden y recortar lo que sobre
    const rows = maxRows;
    ctx.font   = `${weight} ${minSize}px Arial`;
    const groups = greedyWords(ctx, words, rows * SEGMENTS, innerW);
    layout = { size: minSize, rows, segs: [0, 1, 2, 3], groups };
  }

  const { size, rows, segs, groups } = layout;
  const lineH = size + 4;
  const y0    = (top + bottom) / 2 - (rows * lineH) / 2;

  ctx.font         = `${weight} ${size}px Arial`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';

  const widths = groups.map(g => (g ? measure(g) : 0));
  const fills  = karaoke ? karaokeFill(widths, karaoke.progress) : null;
  const base   = ctx.fillStyle;

  groups.forEach((g, i) => {
    if (!g) return;
    const cx = segs[i % segs.length] * SEG_W + SEG_W / 2;
    const y  = y0 + Math.floor(i / segs.length) * lineH;
    ctx.fillStyle = base;
    ctx.fillText(g, cx, y);

    const fill = fills?.[i] ?? 0;
    if (fill > 0) {
      // Repintar en color solo la parte ya cantada (recorte por la izquierda)
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - widths[i] / 2, y - 2, fill, lineH + 2);
      ctx.clip();
      ctx.fillStyle = karaoke!.color;
      ctx.fillText(g, cx, y);
      ctx.restore();
    }
  });
}

/** Llena los grupos en orden con lo que quepa; el último termina en "…" si sobran palabras. */
function greedyWords(ctx: Ctx, words: string[], count: number, maxW: number): string[] {
  const groups: string[] = [];
  let i = 0;
  for (let g = 0; g < count && i < words.length; g++) {
    let line = words[i++];
    while (i < words.length && ctx.measureText(`${line} ${words[i]}`).width <= maxW) line += ` ${words[i++]}`;
    groups.push(fitWidth(ctx, line, maxW));
  }
  if (i < words.length) groups[groups.length - 1] = fitWidth(ctx, `${groups[groups.length - 1]}…`, maxW);
  return groups;
}

// ─── Visualizador ─────────────────────────────────────────────────────────────

export async function renderVisualizerKey(bars: number[]): Promise<string> {
  const canvas = createCanvas(KW, KH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, KW, KH);

  const pad   = 10;
  const gap   = 2;
  const bw    = (KW - pad * 2 - gap * (bars.length - 1)) / bars.length;
  const baseY = KH - pad;
  const maxH  = KH - pad * 2;

  const grad = ctx.createLinearGradient(0, baseY - maxH, 0, baseY);
  grad.addColorStop(0, '#ff6a5a');
  grad.addColorStop(1, C.accent);
  ctx.fillStyle = grad;

  bars.forEach((b, i) => {
    const h = Math.max(2, b * maxH);
    rrect(ctx, pad + i * (bw + gap), baseY - h, bw, h, Math.min(2, bw / 2));
    ctx.fill();
  });

  return toDataUrl(canvas);
}

// ─── Helpers de render ────────────────────────────────────────────────────────

function drawInfoBackground(ctx: Ctx): void {
  // Gradiente sutil de fondo
  const grad = ctx.createLinearGradient(0, 0, 0, KH);
  grad.addColorStop(0, 'rgba(30,30,30,1)');
  grad.addColorStop(1, 'rgba(10,10,10,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, KW, KH);
}

/**
 * Dibuja texto centrado en varias líneas (hasta maxLines), reduciendo el
 * font-size si hace falta; si ni al mínimo cabe, la última línea termina en "…".
 * Se centra verticalmente entre startY y endY.
 */
function drawCenteredText(
  ctx: Ctx, text: string,
  cx: number, startY: number,
  maxW: number, baseFontSize: number,
  weight: 'bold' | 'normal',
  maxLines: number, endY: number,
): void {
  const MIN = 10;
  let size  = baseFontSize;
  let lines: string[] = [];

  for (; size >= MIN; size--) {
    ctx.font = `${weight} ${size}px Arial`;
    lines = wrap(ctx, text, maxW);
    const fitsHeight = lines.length * (size + 4) <= endY - startY;
    if (lines.length <= maxLines && fitsHeight) break;
  }
  if (size < MIN) {
    size     = MIN;
    ctx.font = `${weight} ${size}px Arial`;
    lines    = wrap(ctx, text, maxW);
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = fitWidth(ctx, `${lines[maxLines - 1]}…`, maxW);
  }

  const lineH = size + 4;
  const y0    = (startY + endY) / 2 - (lines.length * lineH) / 2;

  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, cx, y0 + i * lineH));
}

/** Parte el texto en líneas por palabras; palabras más largas que maxW se recortan. */
function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxW || !line) {
      line = test;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.map(l => fitWidth(ctx, l, maxW));
}

/** Recorta con "…" hasta que quepa en maxW con la fuente actual. */
function fitWidth(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text.replace(/…$/, '');
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDataUrl(canvas: any): string {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const buf: Buffer = canvas.toBuffer('image/png');
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function rrect(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y,         x + r, y);
  ctx.closePath();
}
