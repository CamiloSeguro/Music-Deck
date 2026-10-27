import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc } from '../src/lyrics/lrc';
import { currentLyricIndex, lineProgress, lyricsWindow } from '../src/lyrics/sync';

const LRC = [
  '[ar:Alguien]',
  '[00:12.50] Segunda línea',
  '[00:05.00] Primera línea',
  '[00:20.123] Tercera con milisegundos',
  '[00:25.00] ',
  'texto suelto sin tiempo',
].join('\n');

test('parseLrc: ordena, entiende 2 y 3 decimales y salta líneas vacías o sin tiempo', () => {
  const lines = parseLrc(LRC);
  assert.deepEqual(lines.map(l => l.text), ['Primera línea', 'Segunda línea', 'Tercera con milisegundos']);
  assert.equal(lines[0].time, 5);
  assert.equal(lines[1].time, 12.5);
  assert.ok(Math.abs(lines[2].time - 20.123) < 1e-9);
});

test('currentLyricIndex: -1 antes de la primera línea y la última que ya empezó', () => {
  const lines = parseLrc(LRC);
  assert.equal(currentLyricIndex(lines, 0), -1);
  assert.equal(currentLyricIndex(lines, 5), 0);
  assert.equal(currentLyricIndex(lines, 12.49), 0);
  assert.equal(currentLyricIndex(lines, 12.5), 1);
  assert.equal(currentLyricIndex(lines, 999), 2);
  assert.equal(currentLyricIndex([], 10), -1);
});

test('lyricsWindow: anterior, actual y siguiente', () => {
  const lines = parseLrc(LRC);
  assert.deepEqual(lyricsWindow(lines, 13), {
    previous: 'Primera línea', current: 'Segunda línea', next: 'Tercera con milisegundos',
  });
  assert.deepEqual(lyricsWindow(lines, 1), { previous: '', current: '', next: '' });
  assert.equal(lyricsWindow(lines, 30).next, '');
});

test('lineProgress: avanza ~0.35 s por palabra y nunca pasa de 1', () => {
  const lines = [
    { time: 10, text: 'una dos tres cuatro cinco seis' },   // 6 palabras → 2.1 s
    { time: 40, text: 'otra' },
  ];
  assert.equal(lineProgress(lines, 0, 10), 0);
  assert.ok(Math.abs(lineProgress(lines, 0, 11.05) - 0.5) < 1e-9);
  assert.equal(lineProgress(lines, 0, 20), 1);   // instrumental largo: ya se llenó
  assert.equal(lineProgress(lines, -1, 5), 0);
});

test('lineProgress: no se pasa del inicio de la línea siguiente', () => {
  const lines = [
    { time: 10, text: 'muchas palabras seguidas que no caben en tan poco tiempo' },
    { time: 11, text: 'siguiente' },
  ];
  assert.ok(Math.abs(lineProgress(lines, 0, 10.5) - 0.5) < 1e-9);
});
