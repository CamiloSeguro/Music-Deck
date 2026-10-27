import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAccent } from '../src/ui/accent';
import { applySettings, DEFAULT_SETTINGS, settingsVersion } from '../src/settings';

/** Imagen de mentira: `count` píxeles de cada color dado. */
function pixels(...colors: [number, number, number, number][]): number[] {
  const out: number[] = [];
  for (const [r, g, b, count] of colors) for (let i = 0; i < count; i++) out.push(r, g, b, 255);
  return out;
}

function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

test('pickAccent: elige el color vivo dominante aunque haya mucho negro', () => {
  const accent = pickAccent(pixels([10, 10, 10, 600], [30, 90, 220, 300], [200, 40, 40, 100]));
  assert.ok(accent);
  const h = hueOf(accent!);
  assert.ok(h > 200 && h < 240, `debería ser azul, dio ${accent} (h=${h})`);
});

test('pickAccent: portada en escala de grises → null (usar el acento por defecto)', () => {
  assert.equal(pickAccent(pixels([20, 20, 20, 500], [128, 128, 128, 300], [240, 240, 240, 200])), null);
});

test('pickAccent: el resultado es legible sobre fondo oscuro (ni muy oscuro ni lavado)', () => {
  const accent = pickAccent(pixels([60, 0, 0, 1000]))!;   // rojo muy oscuro
  const [r, g, b] = [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16));
  const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
  assert.ok(l >= 0.49 && l <= 0.63, `luz ${l} fuera de rango (${accent})`);
});

test('applySettings: valida, limita y completa con los valores por defecto', () => {
  const v0 = settingsVersion();
  const s = applySettings({
    lyricsOffsetMs: 99_999,      // se limita a 2000
    lyricsSize: 'gigante',       // inválido → por defecto
    showNextLine: false,
    accentColor: 'rojo',         // inválido → por defecto
    seekStep: '10',              // string numérico desde el PI → 10
  });
  assert.equal(s.lyricsOffsetMs, 2000);
  assert.equal(s.lyricsSize, DEFAULT_SETTINGS.lyricsSize);
  assert.equal(s.showNextLine, false);
  assert.equal(s.karaoke, DEFAULT_SETTINGS.karaoke);
  assert.equal(s.accentColor, DEFAULT_SETTINGS.accentColor);
  assert.equal(s.seekStep, 10);
  assert.ok(settingsVersion() > v0);
});

test('applySettings: basura → todo por defecto', () => {
  assert.deepEqual(applySettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(applySettings('x'), DEFAULT_SETTINGS);
});
