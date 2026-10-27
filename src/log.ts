/**
 * log.ts
 * Log de depuración en <plugin>/debug.log con tamaño máximo.
 * Al pasar MAX_BYTES se rota a debug.log.1 (se conserva solo una copia).
 */
import { appendFileSync, renameSync, statSync } from 'fs';
import { join } from 'path';

// __dirname = <plugin>/bin/ → subir un nivel al plugin root
const LOG_FILE  = join(__dirname, '..', 'debug.log');
const MAX_BYTES = 5 * 1024 * 1024;

let written = -1;   // bytes estimados en el archivo actual (-1 = sin leer aún)

export function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (written < 0) {
      try { written = statSync(LOG_FILE).size; } catch { written = 0; }
    }
    if (written + line.length > MAX_BYTES) {
      renameSync(LOG_FILE, `${LOG_FILE}.1`);
      written = 0;
    }
    appendFileSync(LOG_FILE, line);
    written += line.length;
  } catch { /* noop */ }
}
