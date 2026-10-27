import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centerGroups, karaokeFill, partitionWords } from '../src/ui/segment-layout';

// Fuente monoespaciada de mentira: 10 px por carácter
const measure = (s: string) => s.length * 10;

test('partitionWords: conserva el texto y el orden, sin partir palabras', () => {
  const text   = 'Soy rapero porque puedo y me fumo lo que no me bebo esperen';
  const groups = partitionWords(text.split(' '), 4, measure);
  assert.equal(groups.length, 4);
  assert.equal(groups.filter(Boolean).join(' '), text);
  for (const g of groups) for (const w of g.split(' ').filter(Boolean)) assert.ok(text.split(' ').includes(w));
});

test('partitionWords: reparte equilibrado (minimiza el grupo más ancho)', () => {
  const groups = partitionWords('aa bb cc dd ee ff gg hh'.split(' '), 4, measure);
  assert.deepEqual(groups, ['aa bb', 'cc dd', 'ee ff', 'gg hh']);
});

test('partitionWords: con menos palabras que grupos, las centra', () => {
  assert.deepEqual(partitionWords(['Yeah'], 4, measure), ['', 'Yeah', '', '']);
  assert.deepEqual(partitionWords(['Tú', 'no'], 4, measure), ['', 'Tú', 'no', '']);
});

test('centerGroups: no toca listas llenas o vacías', () => {
  assert.deepEqual(centerGroups(['a', 'b']), ['a', 'b']);
  assert.deepEqual(centerGroups(['', '']), ['', '']);
  assert.deepEqual(centerGroups(['', '', 'a', 'b']), ['', 'a', 'b', '']);
});

test('karaokeFill: llena los grupos en orden de lectura', () => {
  assert.deepEqual(karaokeFill([100, 50, 50], 0), [0, 0, 0]);
  assert.deepEqual(karaokeFill([100, 50, 50], 0.5), [100, 0, 0]);
  assert.deepEqual(karaokeFill([100, 50, 50], 0.75), [100, 50, 0]);
  assert.deepEqual(karaokeFill([100, 50, 50], 1), [100, 50, 50]);
  assert.deepEqual(karaokeFill([100, 0, 100], 0.6), [100, 0, 20]);
  assert.deepEqual(karaokeFill([10], 3), [10]);   // progreso > 1 se limita
});
