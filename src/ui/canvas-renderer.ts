/**
 * canvas-renderer.ts
 * Genera imágenes PNG 144×144 para cada tipo de botón de Music Deck.
 *
 *  renderAlbumArtKey(quadrant, media) → portada recortada (cuadrante 0-3)
 *  renderControlKey(actionId, media)  → play/pause, next, previous
 *  renderTitleKey(media)              → título de la canción
 *  renderArtistKey(media)             → artista
 *  renderDurationKey(media)           → posición / duración
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { MediaInfo } from '../types';

const KW = 144;
const KH = 144;

const C = {
  bg:      '#111111',
  accent:  '#e03030',
  text:    '#ffffff',
  dim:     '#aaaaaa',
  dimDark: '#555555',
  label:   '#666666',
  progBg:  '#2a2a2a',
};

type Ctx = SKRSContext2D;

// ─── Dispatcher central ───────────────────────────────────────────────────────

export async function renderKey(actionId: string, media: MediaInfo | null): Promise<string> {
  if (actionId.startsWith('dev.camiloseguro.musicdeck.albumart.')) {
    const q = parseInt(actionId.slice(-1), 10) as 0 | 1 | 2 | 3;
    return renderAlbumArtKey(q, media);
  }
  if (actionId === 'dev.camiloseguro.musicdeck.title')    return renderTitleKey(media);
  if (actionId === 'dev.camiloseguro.musicdeck.artist')   return renderArtistKey(media);
  if (actionId === 'dev.camiloseguro.musicdeck.duration') return renderDurationKey(media);
  return renderControlKey(actionId, media);
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

  if (!media?.thumbnailBase64) {
    drawNoArtPlaceholder(ctx, quadrant);
    return toDataUrl(canvas);
  }

  try {
    const img = await loadImage(Buffer.from(media.thumbnailBase64, 'base64'));
    // Dibujamos la imagen completa a 288×288 y usamos el offset del cuadrante
    const ox = (quadrant === 1 || quadrant === 3) ? -KW : 0;
    const oy = (quadrant === 2 || quadrant === 3) ? -KH : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, KW, KH);
    ctx.clip();
    ctx.drawImage(img, ox, oy, KW * 2, KH * 2);
    ctx.restore();
  } catch {
    drawNoArtPlaceholder(ctx, quadrant);
  }

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
  if (media?.thumbnailBase64) {
    try {
      const img = await loadImage(Buffer.from(media.thumbnailBase64, 'base64'));
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.drawImage(img, 0, 0, KW, KH);
      ctx.globalAlpha = 1;
      ctx.restore();
    } catch { /* sin portada */ }
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

  drawInfoBackground(ctx, media);

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
    drawCenteredText(ctx, media.title, KW / 2, 34, KW - 16, 15, 'bold');
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

  drawInfoBackground(ctx, media);

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
    drawCenteredText(ctx, media.artist, KW / 2, 34, KW - 16, 14, 'normal');
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

  drawInfoBackground(ctx, media);

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

// ─── Helpers de render ────────────────────────────────────────────────────────

function drawInfoBackground(ctx: Ctx, media: MediaInfo | null): void {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, KW, KH);

  if (media?.thumbnailBase64) {
    try {
      // No podemos await aquí, se llama de forma síncrona como fondo suave
      // Se carga en las funciones que lo necesitan
    } catch { /* noop */ }
  }

  // Gradiente sutil de fondo
  const grad = ctx.createLinearGradient(0, 0, 0, KH);
  grad.addColorStop(0, 'rgba(30,30,30,1)');
  grad.addColorStop(1, 'rgba(10,10,10,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, KW, KH);
}

/**
 * Dibuja texto centrado con font-size que se reduce automáticamente si no cabe.
 */
function drawCenteredText(
  ctx: Ctx, text: string,
  cx: number, startY: number,
  maxW: number, baseFontSize: number,
  weight: 'bold' | 'normal',
): void {
  let size = baseFontSize;
  ctx.font = `${weight} ${size}px Arial`;

  while (ctx.measureText(text).width > maxW && size > 9) {
    size--;
    ctx.font = `${weight} ${size}px Arial`;
  }

  // Si aún no cabe, truncar
  let display = text;
  while (ctx.measureText(display).width > maxW && display.length > 1) {
    display = display.slice(0, -1);
  }
  if (display !== text) display = display.slice(0, -1) + '…';

  // Centrar verticalmente en el espacio disponible
  const lineH  = size + 4;
  const words  = display.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length >= 3) { line += '…'; break; }
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const totalH = lines.length * lineH;
  const midY   = startY + (KH - startY - 20) / 2;
  const y0     = midY - totalH / 2;

  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, cx, y0 + i * lineH));
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
