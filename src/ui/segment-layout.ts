/**
 * segment-layout.ts
 * Reparte las palabras de un texto entre varias pantallas (los knobs) sin
 * partir ninguna palabra entre dos. Sin dependencias de canvas: recibe una
 * función `measure` que da el ancho de un texto con la fuente actual.
 */

export type Measure = (text: string) => number;

/**
 * Reparte las palabras (en orden) en `count` grupos minimizando el ancho del
 * grupo más ancho, para que el texto quede equilibrado entre las pantallas.
 * Con menos palabras que grupos, los vacíos quedan a los lados (ver centerGroups).
 */
export function partitionWords(words: string[], count: number, measure: Measure): string[] {
  const n     = words.length;
  const join  = (i: number, j: number) => words.slice(i, j).join(' ');
  // Ancho de words[i..j) = suma de palabras + espacios (medir cada palabra una vez)
  const space = measure(' ');
  const pre   = [0];
  for (const w of words) pre.push(pre[pre.length - 1] + measure(w));
  const width = (i: number, j: number) => (i === j ? 0 : pre[j] - pre[i] + space * (j - i - 1));

  // best[k][j] = ancho máximo mínimo poniendo las primeras j palabras en k grupos
  const best: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const cut:  number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(0));
  best[0][0] = 0;
  for (let k = 1; k <= count; k++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= j; i++) {
        const w = Math.max(best[k - 1][i], width(i, j));
        if (w < best[k][j]) { best[k][j] = w; cut[k][j] = i; }
      }
    }
  }

  const groups: string[] = [];
  for (let k = count, j = n; k > 0; k--) {
    const i = cut[k][j];
    groups.unshift(join(i, j));
    j = i;
  }
  return centerGroups(groups);
}

/**
 * Con menos palabras que pantallas, el reparto deja grupos vacíos al principio.
 * Se mueven al centro para que el texto no quede cargado a un lado.
 */
export function centerGroups(groups: string[]): string[] {
  const filled = groups.filter(Boolean);
  if (filled.length === groups.length || filled.length === 0) return groups;
  const out  = new Array<string>(groups.length).fill('');
  const from = Math.floor((groups.length - filled.length) / 2);
  filled.forEach((g, i) => { out[from + i] = g; });
  return out;
}

/**
 * Para el karaoke: cuántos píxeles de cada grupo ya se cantaron, si el avance
 * total es `progress` (0–1) del ancho de todos los grupos leídos en orden.
 */
export function karaokeFill(widths: number[], progress: number): number[] {
  const total = widths.reduce((a, b) => a + b, 0);
  let left    = total * Math.min(1, Math.max(0, progress));
  return widths.map((w) => {
    const fill = Math.min(w, left);
    left -= fill;
    return fill;
  });
}
