/**
 * accent.ts
 * Elige un color de acento a partir de la portada: el tono vivo que más
 * pesa en la imagen, ajustado para que se vea bien sobre fondo oscuro.
 */

/**
 * @param rgba píxeles RGBA (p. ej. de getImageData de la portada reducida)
 * @returns color "#rrggbb", o null si la portada es casi gris (sin color claro)
 */
export function pickAccent(rgba: ArrayLike<number>): string | null {
  const BUCKETS = 24;   // tonos de 15°
  const weight  = new Array<number>(BUCKETS).fill(0);
  const sumR    = new Array<number>(BUCKETS).fill(0);
  const sumG    = new Array<number>(BUCKETS).fill(0);
  const sumB    = new Array<number>(BUCKETS).fill(0);
  let pixels = 0;

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    pixels++;
    const [h, s, v] = rgbToHsv(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (s < 0.25 || v < 0.2) continue;   // grises, negros: no sirven de acento
    const b = Math.floor(h * BUCKETS) % BUCKETS;
    const w = s * v;                     // más vivo → pesa más
    weight[b] += w;
    sumR[b]   += rgba[i] * w;
    sumG[b]   += rgba[i + 1] * w;
    sumB[b]   += rgba[i + 2] * w;
  }

  let best = -1;
  for (let b = 0; b < BUCKETS; b++) if (best < 0 || weight[b] > weight[best]) best = b;
  // Muy poco color en toda la imagen → mejor el acento por defecto
  if (best < 0 || pixels === 0 || weight[best] < pixels * 0.03) return null;

  const r = sumR[best] / weight[best];
  const g = sumG[best] / weight[best];
  const bl = sumB[best] / weight[best];
  const [h, s, l] = rgbToHsl(r, g, bl);
  // Saturado y con luz media: legible sobre #111 sin encandilar
  return hslToHex(h, Math.max(s, 0.55), Math.min(0.62, Math.max(0.5, l)));
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h = (h / 6 + 1) % 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [h] = rgbToHsv(r, g, b);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
