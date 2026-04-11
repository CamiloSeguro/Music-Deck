/**
 * visualizer.ts
 * Genera el estado animado del visualizador de barras.
 * No usa audio real — simula movimiento orgánico con targets aleatorios
 * y suavizado exponencial. Cuando está pausado, las barras bajan suavemente.
 */

export interface VisualizerState {
  bars:    number[];   // altura actual 0–1
  targets: number[];   // altura objetivo 0–1
  lastMs:  number;     // timestamp del último update
}

const BAR_COUNT = 24;

export function createVisualizer(): VisualizerState {
  return {
    bars:   Array.from({ length: BAR_COUNT }, () => Math.random() * 0.25 + 0.05),
    targets: Array.from({ length: BAR_COUNT }, () => Math.random() * 0.6 + 0.1),
    lastMs: Date.now(),
  };
}

export function updateVisualizer(state: VisualizerState, isPlaying: boolean): VisualizerState {
  const now = Date.now();
  const dt  = Math.min((now - state.lastMs) / 1000, 0.15);  // clamp a 150 ms

  // Actualizar targets aleatoriamente (solo si está reproduciendo)
  const targets = state.targets.map((t, i) => {
    if (!isPlaying) return 0.04;

    if (Math.random() < 0.06) {
      // Distribución en campana: el centro tiende a más alto
      const half  = BAR_COUNT / 2;
      const dist  = Math.abs(i - half) / half;         // 0 (centro) – 1 (borde)
      const maxH  = Math.max(0.25, 1 - dist * 0.55);
      return Math.random() * maxH;
    }
    return t;
  });

  // Suavizado exponencial para cada barra
  const speed = isPlaying ? 5.0 : 3.5;
  const bars  = state.bars.map((b, i) => {
    const factor = Math.min(1, speed * dt);
    return b + (targets[i] - b) * factor;
  });

  return { bars, targets, lastMs: now };
}
