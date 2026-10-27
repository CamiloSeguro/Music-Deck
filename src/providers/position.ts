/**
 * position.ts
 * Estima la posición actual de la canción a partir de lecturas imprecisas.
 *
 * Apple Music reporta la posición truncada a segundos enteros, así que cada
 * lectura puede ir hasta ~1 s ATRASADA, pero nunca adelantada. El estimador
 * avanza con el reloj y solo se mueve hacia adelante con lecturas nuevas;
 * hacia atrás solo si el salto es grande (seek, canción nueva) o si se pausó.
 */
export class PositionSmoother {
  private anchorPos = 0;
  private anchorAt  = 0;
  private playing   = false;
  private key       = '';

  /** @param jumpS diferencia (s) a partir de la cual una lectura se toma como salto real */
  constructor(private readonly jumpS = 1.5) {}

  /**
   * @param key     identifica la canción (cambia → se acepta la lectura tal cual)
   * @param est     posición estimada (s) en el instante `now` según la lectura
   * @param playing si está sonando
   * @param now     ms (Date.now())
   */
  update(key: string, est: number, playing: boolean, now: number): void {
    const predicted = this.at(now);
    const reset = key !== this.key || !playing || !this.playing || Math.abs(est - predicted) > this.jumpS;
    if (reset || est > predicted) {
      this.anchorPos = est;
      this.anchorAt  = now;
    }
    this.key     = key;
    this.playing = playing;
  }

  /** Posición estimada (s) en el instante `now`. */
  at(now: number): number {
    return this.playing ? this.anchorPos + (now - this.anchorAt) / 1000 : this.anchorPos;
  }
}
