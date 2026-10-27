import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PositionSmoother } from '../src/providers/position';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('avanza con el reloj mientras suena', () => {
  const p = new PositionSmoother();
  p.update('song', 10, true, 0);
  close(p.at(2_500), 12.5);
});

test('lecturas truncadas (atrasadas) no lo hacen retroceder; las adelantadas sí lo corrigen', () => {
  const p = new PositionSmoother();
  // Posición real 10.8 s, pero Apple Music reporta 10 (truncado)
  p.update('song', 10, true, 0);
  // 1 s después reporta 11 (real 11.8): la lectura nueva va adelante de la estimación (11) → se acepta
  p.update('song', 11, true, 1_000);
  close(p.at(1_000), 11);
  // Una lectura un poco atrasada (10.6 cuando la estimación va en 11.5) se ignora
  p.update('song', 10.6, true, 1_500);
  close(p.at(1_500), 11.5);
});

test('un salto grande hacia atrás (seek) sí se acepta', () => {
  const p = new PositionSmoother();
  p.update('song', 100, true, 0);
  p.update('song', 30, true, 1_000);
  close(p.at(1_000), 30);
});

test('canción nueva: se toma la lectura tal cual', () => {
  const p = new PositionSmoother();
  p.update('a', 200, true, 0);
  p.update('b', 0.5, true, 1_000);
  close(p.at(1_000), 0.5);
});

test('en pausa no avanza y acepta la posición reportada', () => {
  const p = new PositionSmoother();
  p.update('song', 50, true, 0);
  p.update('song', 49.7, false, 1_000);
  close(p.at(5_000), 49.7);
});
