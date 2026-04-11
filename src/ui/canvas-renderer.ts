/**
 * canvas-renderer.ts
 * Genera imágenes PNG para StreamDock:
 *
 *   renderTouchStrip()  → 800×80 px  para la pantalla touch (SecondaryScreen)
 *   renderControlKey()  → 144×144 px para botones normales (Keypad)
 *
 * Dimensiones verificadas contra el plugin com.claude.tracker.sdPlugin.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { MediaInfo, LyricLine } from '../types';
import { lyricsWindow }  from '../lyrics/sync';
import type { VisualizerState } from './visualizer';

// ─── Colores ──────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0d0d0d',
  accent:  '#e03030',
  text:    '#ffffff',
  dim:     '#888888',
  dimDark: '#444444',
  progBg:  '#2a2a2a',
};

type Ctx = SKRSContext2D;

// ─────────────────────────────────────────────────────────────────────────────
//  PANTALLA TOUCH  800×80
// ─────────────────────────────────────────────────────────────────────────────

const TH = 80;  // touch height (fijo)

/**
 * Layout proporcional al ancho real del touchbar (default 750):
 *  [0 .. TH]          → portada / visualizador (cuadrado TH×TH)
 *  [TH+8 .. TH+8+220] → título, artista, progreso
 *  resto izquierdo    → letra actual
 *  último 25%         → letra siguiente
 */
export async function renderTouchStrip(
  media:    MediaInfo | null,
  lyrics:   LyricLine[],
  viz:      VisualizerState,
  width   = 750,
  accent  = C.accent,
): Promise<string> {
  const TW = width;
  const canvas = createCanvas(TW, TH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, TW, TH);

  if (!media) {
    drawIdleStrip(ctx, TW, accent);
    return toDataUrl(canvas);
  }

  const artW  = TH;    // 80 px cuadrado
  const infoX = artW + 8;

  await drawArt(ctx, media, viz, accent, 0, 0, artW, TH);

  const hasLyrics = lyrics.length > 0;
  const infoW = Math.round(TW * 0.28);
  const curX  = infoX + infoW + 8;
  const curW  = TW - curX - 4;

  drawInfoPanel(ctx, media, accent, infoX, 0, infoW, TH);
  if (hasLyrics && curW > 40) {
    drawLyricPanel(ctx, lyrics, media.position, 'current', accent, curX, 0, curW, TH);
  }

  return toDataUrl(canvas);
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOTONES  144×144
// ─────────────────────────────────────────────────────────────────────────────

const KW = 144;
const KH = 144;

export async function renderControlKey(
  actionId: string,
  media:    MediaInfo | null,
  accent  = C.accent,
): Promise<string> {
  const canvas = createCanvas(KW, KH);
  const ctx    = canvas.getContext('2d');

  const isPlay = actionId === 'dev.camiloseguro.musicdeck.playpause';
  const isNext = actionId === 'dev.camiloseguro.musicdeck.next';
  const isPrev = actionId === 'dev.camiloseguro.musicdeck.previous';
  const playing = media?.isPlaying ?? false;

  // ── Fondo: portada a pantalla completa con overlay oscuro fuerte ──────────
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, KW, KH);

  if (media?.thumbnailBase64) {
    try {
      const img = await loadImage(Buffer.from(media.thumbnailBase64, 'base64'));
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(img, 0, 0, KW, KH);
      ctx.globalAlpha = 1;
      ctx.restore();
    } catch { /* sin portada */ }
  }

  // Gradiente oscuro sobre la portada para legibilidad
  const grad = ctx.createLinearGradient(0, 0, 0, KH);
  grad.addColorStop(0,   'rgba(0,0,0,0.55)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.30)');
  grad.addColorStop(1,   'rgba(0,0,0,0.80)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, KW, KH);

  // ── Borde superior de acento ─────────────────────────────────────────────
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, KW, 3);

  // ── Símbolo grande en el centro del botón ────────────────────────────────
  const cx = KW / 2;
  const cy = KH / 2 - 10;
  const R  = 28;   // radio círculo de fondo del símbolo

  // Círculo de fondo
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = isPlay && playing
    ? accent
    : 'rgba(255,255,255,0.12)';
  ctx.fill();

  // Símbolo dibujado
  ctx.fillStyle = isPlay && playing ? '#000' : accent;

  if (isPlay) {
    if (playing) {
      // Pausa: dos barras
      const bw = 7; const bh = 20; const gap = 6;
      ctx.fillRect(cx - gap / 2 - bw, cy - bh / 2, bw, bh);
      ctx.fillRect(cx + gap / 2,      cy - bh / 2, bw, bh);
    } else {
      // Play: triángulo
      ctx.beginPath();
      ctx.moveTo(cx - 9,  cy - 14);
      ctx.lineTo(cx + 16, cy);
      ctx.lineTo(cx - 9,  cy + 14);
      ctx.closePath();
      ctx.fill();
    }
  } else if (isNext) {
    // Dos triángulos apuntando derecha + barra
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy - 13); ctx.lineTo(cx - 1, cy); ctx.lineTo(cx - 14, cy + 13);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 1, cy - 13); ctx.lineTo(cx + 12, cy); ctx.lineTo(cx - 1, cy + 13);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(cx + 12, cy - 13, 4, 26);
  } else if (isPrev) {
    // Barra + dos triángulos apuntando izquierda
    ctx.fillRect(cx - 16, cy - 13, 4, 26);
    ctx.beginPath();
    ctx.moveTo(cx + 14, cy - 13); ctx.lineTo(cx + 1, cy); ctx.lineTo(cx + 14, cy + 13);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy - 13); ctx.lineTo(cx - 12, cy); ctx.lineTo(cx + 1, cy + 13);
    ctx.closePath(); ctx.fill();
  }

  // ── Texto: título y artista en la parte inferior ─────────────────────────
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';

  if (media?.title) {
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 13px Arial';
    ctx.fillText(clip(media.title, 16), KW / 2, KH - 18);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font      = '11px Arial';
    ctx.fillText(clip(media.artist, 18), KW / 2, KH - 5);
  } else {
    ctx.fillStyle = C.dimDark;
    ctx.font      = '11px Arial';
    ctx.fillText('Sin media', KW / 2, KH - 8);
  }

  return toDataUrl(canvas);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Secciones internas del touch strip
// ─────────────────────────────────────────────────────────────────────────────

function drawIdleStrip(ctx: Ctx, TW: number, accent: string): void {
  ctx.fillStyle    = '#161616';
  ctx.fillRect(0, 0, TW, TH);
  ctx.fillStyle    = C.dimDark;
  ctx.font         = '13px Arial';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♪  Sin media activo', TW / 2, TH / 2);
}

async function drawArt(
  ctx: Ctx, media: MediaInfo, viz: VisualizerState, accent: string,
  x: number, y: number, w: number, h: number,
): Promise<void> {
  if (media.thumbnailBase64) {
    try {
      const img = await loadImage(Buffer.from(media.thumbnailBase64, 'base64'));
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      return;
    } catch { /* fallthrough */ }
  }
  drawViz(ctx, viz, media.isPlaying, accent, x, y, w, h);
}

function drawInfoPanel(
  ctx: Ctx, media: MediaInfo, accent: string,
  x: number, y: number, w: number, h: number,
): void {
  const pad = 6;
  const tx  = x + pad;

  // Indicador play/pause (top-right)
  ctx.fillStyle    = accent;
  ctx.font         = '11px Arial';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(media.isPlaying ? '▶' : '⏸', x + w - pad, y + pad);

  // Título
  ctx.fillStyle    = C.text;
  ctx.font         = 'bold 13px Arial';
  ctx.textAlign    = 'left';
  ctx.fillText(clip(media.title, 22), tx, y + 8);

  // Artista
  ctx.fillStyle = C.dim;
  ctx.font      = '11px Arial';
  ctx.fillText(clip(media.artist, 26), tx, y + 27);

  // Álbum
  ctx.font = '10px Arial';
  ctx.fillText(clip(media.album, 28), tx, y + 43);

  // Barra de progreso
  if (media.duration > 0) {
    const pct  = Math.min(1, media.position / media.duration);
    const barY = y + h - 14;
    const barW = w - pad * 2;

    ctx.fillStyle = C.progBg;
    rrect(ctx, tx, barY, barW, 3, 1.5);
    ctx.fill();

    ctx.fillStyle = accent;
    rrect(ctx, tx, barY, barW * pct, 3, 1.5);
    ctx.fill();

    // Tiempos
    ctx.fillStyle    = C.dimDark;
    ctx.font         = '8px Arial';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmt(media.position), tx, y + h - 2);
    ctx.textAlign = 'right';
    ctx.fillText(fmt(media.duration), x + w - pad, y + h - 2);
  }
}

function drawLyricPanel(
  ctx:      Ctx,
  lyrics:   LyricLine[],
  position: number,
  which:    'current' | 'next',
  accent:   string,
  x: number, y: number, w: number, h: number,
): void {
  const win    = lyricsWindow(lyrics, position);
  const text   = which === 'current' ? win.current : win.next;
  const active = which === 'current';

  // Separador vertical sutil
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(x - 4, y + 8, 1, h - 16);

  if (!text) {
    ctx.fillStyle    = C.dimDark;
    ctx.font         = '16px Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♪', x + w / 2, y + h / 2);
    return;
  }

  // Halo suave detrás de la letra activa
  if (active) {
    const rad = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.65);
    rad.addColorStop(0, hexAlpha(accent, 0.10));
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rad;
    ctx.fillRect(x, y, w, h);
  }

  ctx.fillStyle    = active ? C.text : C.dimDark;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = active ? `bold 15px Arial` : `11px Arial`;

  const lines  = wrapText(ctx, text, w - 14);
  const lineH  = 17;
  const startY = y + h / 2 - ((lines.length - 1) * lineH) / 2;

  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, startY + i * lineH));

  // Punto de acento
  if (active) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h - 6, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Visualizador de barras
// ─────────────────────────────────────────────────────────────────────────────

function drawViz(
  ctx: Ctx, viz: VisualizerState, playing: boolean, accent: string,
  x: number, y: number, w: number, h: number,
): void {
  const n    = viz.bars.length;
  const barW = w / n;
  const gap  = 1;

  viz.bars.forEach((bh, i) => {
    const height = Math.max(3, bh * (h - 8));
    const bx     = x + i * barW + gap / 2;
    const by     = y + h - height - 4;
    const bw     = barW - gap;

    const grad = ctx.createLinearGradient(bx, by + height, bx, by);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, `rgba(255,255,255,${0.15 + bh * 0.3})`);

    ctx.globalAlpha = playing ? 0.85 : 0.35;
    ctx.fillStyle   = grad;
    rrect(ctx, bx, by, bw, height, [2, 2, 0, 0]);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
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

function drawArtPlaceholder(ctx: Ctx, x: number, y: number, size: number, accent: string): void {
  ctx.fillStyle = '#1a1a1a';
  roundRect(ctx, x, y, size, size, 8);
  ctx.fill();
  ctx.fillStyle = hexAlpha(accent, 0.3);
  ctx.font      = `${Math.round(size * 0.4)}px Arial`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♪', x + size / 2, y + size / 2);
}

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

function wrapText(ctx: Ctx, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function rrect(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  r: number | [number, number, number, number],
): void {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h,     x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y,         x + tl, y);
  ctx.closePath();
}

function hexAlpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
