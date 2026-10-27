/**
 * smtc-windows.ts
 *
 * Uses a pre-compiled .NET console app (SmtcNative.exe) to read Windows SMTC.
 * The exe handles WinRT async correctly — PowerShell 5.1 cannot.
 *
 * Loop mode: SmtcNative.exe (no args) writes one JSON line per tick to stdout.
 *   Protocol v2 (announced with {"status":"hello","protocol":2}):
 *     - the thumbnail is only sent when it changes (`thumbChanged: true`)
 *     - accepts control commands on stdin, one per line (play, next, ...)
 *   Older builds send the thumbnail on every line and ignore stdin.
 * Control mode: SmtcNative.exe <action> sends command and exits (fallback for v1).
 *
 * The exe is at: scripts/SmtcNative/bin/Release/net<N>.0-windows10.0.19041.0/SmtcNative.exe
 * (the newest build that can run on an installed .NET runtime).
 * If the exe is missing, startSmtcLoop() will attempt to build it via `dotnet build`.
 */

import { spawn, execFile, type ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { log } from '../log';
import type { MediaInfo, ControlAction } from '../types';

function smtcLog(msg: string): void {
  log(`[SMTC] ${msg}`);
}

// ─── Paths ────────────────────────────────────────────────────────────────────

// __dirname = <plugin>/bin/providers/ → subir dos niveles para llegar al plugin root
const SCRIPTS_DIR = join(__dirname, '..', '..', 'scripts');
const CSPROJ      = join(SCRIPTS_DIR, 'SmtcNative', 'SmtcNative.csproj');

/** Finds the SmtcNative.exe — newest build whose .NET runtime can run it. */
export function findExe(): string | null {
  const base = join(SCRIPTS_DIR, 'SmtcNative', 'bin', 'Release');
  if (!existsSync(base)) return null;

  const installed = installedRuntimeMajors();
  try {
    const tfms = readdirSync(base)
      .map(tfm => ({ tfm, major: Number(/^net(\d+)\.\d+-windows/.exec(tfm)?.[1]) }))
      .filter(t => !Number.isNaN(t.major))
      .sort((a, b) => b.major - a.major);
    for (const { tfm, major } of tfms) {
      const dir       = join(base, tfm);
      const candidate = join(dir, 'SmtcNative.exe');
      if (!existsSync(candidate)) continue;
      if (installed && !canRun(dir, major, installed)) continue;
      return candidate;
    }
  } catch { /* ignore */ }
  return null;
}

/** Same major installed, or a newer one when the build allows rollForward=Major. */
function canRun(dir: string, major: number, installed: Set<number>): boolean {
  if (installed.has(major)) return true;
  try {
    const cfg = JSON.parse(readFileSync(join(dir, 'SmtcNative.runtimeconfig.json'), 'utf8')) as
      { runtimeOptions?: { rollForward?: string } };
    const rf = cfg.runtimeOptions?.rollForward?.toLowerCase();
    if (rf === 'major' || rf === 'latestmajor') return [...installed].some(m => m > major);
  } catch { /* sin runtimeconfig → no podemos asumir roll-forward */ }
  return false;
}

/** Major versions of Microsoft.NETCore.App installed, or null if unknown. */
function installedRuntimeMajors(): Set<number> | null {
  const root = process.env.DOTNET_ROOT ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'dotnet');
  try {
    const versions = readdirSync(join(root, 'shared', 'Microsoft.NETCore.App'));
    return new Set(versions.map(v => Number(v.split('.')[0])).filter(n => !Number.isNaN(n)));
  } catch {
    return null;
  }
}

// ─── Estado interno ───────────────────────────────────────────────────────────

const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 60_000;

let loopProc:    ChildProcess | null = null;
let lineBuffer = '';
let stopped    = false;
let current:   MediaInfo | null = null;
let posReadAt  = 0;   // ms UTC de cuando SmtcNative leyó la posición (positionTs del JSON)
let protocol   = 1;   // versión del protocolo del exe en ejecución
let thumbnail: string | null = null;   // última portada recibida (v2 solo la manda al cambiar)
let retryMs    = RETRY_MIN_MS;
let lastExit   = '';  // último mensaje de salida, para no repetirlo en el log

let spectrumWanted = false;            // el plugin quiere el espectro (hay un visualizador visible)
let spectrumBands: number[] | null = null;
let spectrumAt     = 0;
const volumeWaiters: ((level: number | null) => void)[] = [];

// ─── Build helper ─────────────────────────────────────────────────────────────

function buildExe(): Promise<void> {
  return new Promise((resolve, reject) => {
    smtcLog('Compilando SmtcNative.exe (primera vez, puede tomar unos segundos)...');
    const proc = execFile(
      'dotnet',
      ['build', CSPROJ, '-c', 'Release', '--nologo', '-v', 'q'],
      { timeout: 60_000 },
      (err, _stdout, stderr) => {
        if (err) {
          smtcLog(`Error compilando SmtcNative: ${stderr}`);
          reject(err);
        } else {
          smtcLog('SmtcNative.exe compilado correctamente.');
          resolve();
        }
      },
    );
    proc.on('error', reject);
  });
}

// ─── Proceso persistente ──────────────────────────────────────────────────────

export function startSmtcLoop(): void {
  stopped = false;
  void launchLoop();
}

export function stopSmtcLoop(): void {
  stopped = true;
  loopProc?.kill();
  loopProc = null;
}

export function getSmtcCurrentMedia(): MediaInfo | null {
  if (!current || !current.isPlaying) return current;
  // Interpolar posición: SMTC actualiza cada ~1s, compensamos el tiempo transcurrido
  const elapsed = (Date.now() - posReadAt) / 1000;
  const pos     = Math.min(current.position + elapsed, current.duration);
  return { ...current, position: pos };
}

function scheduleRelaunch(): void {
  if (stopped) return;
  setTimeout(() => void launchLoop(), retryMs);
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
}

async function launchLoop(): Promise<void> {
  if (stopped) return;

  let exePath = findExe();

  if (!exePath) {
    try {
      await buildExe();
      exePath = findExe();
    } catch {
      smtcLog(`No se pudo compilar SmtcNative.exe. Reintentando en ${retryMs / 1000} s.`);
      scheduleRelaunch();
      return;
    }
  }

  if (!exePath || stopped) return;
  smtcLog(`spawning ${exePath}`);

  protocol   = 1;
  lineBuffer = '';
  const startedAt = Date.now();
  const stderrTail: string[] = [];

  const proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  loopProc = proc;

  proc.stdin?.on('error', () => { /* v1 no lee stdin; ignorar EPIPE */ });
  proc.stdout?.setEncoding('utf8');
  proc.stdout?.on('data', (chunk: string) => {
    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    lineBuffer  = lines.pop() ?? '';
    for (const line of lines) handleLine(line.trim());
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    // Mientras está sano, todo va al log; si muere, guardamos el final para un solo resumen
    stderrTail.push(text);
    if (stderrTail.length > 20) stderrTail.shift();
    if (Date.now() - startedAt > 5_000) smtcLog(text);
  });

  proc.on('exit', (code) => {
    if (loopProc === proc) loopProc = null;
    const ranLong = Date.now() - startedAt > 30_000;
    if (ranLong) retryMs = RETRY_MIN_MS;   // estuvo sano un rato → reintento rápido

    const summary = `SmtcNative terminó (código ${String(code)}): ${stderrTail.join(' | ').slice(0, 2000)}`;
    // No repetir el mismo error en cada reintento (así se llenó el log a 2.5 GB)
    if (summary !== lastExit) smtcLog(summary);
    else smtcLog(`SmtcNative terminó otra vez (mismo error). Reintento en ${retryMs / 1000} s.`);
    lastExit = summary;
    scheduleRelaunch();
  });

  proc.on('error', (err) => {
    smtcLog(`Error al lanzar SmtcNative.exe: ${err.message}`);
  });
}

function handleLine(raw: string): void {
  if (!raw) return;
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw) as Record<string, unknown>; } catch { return; }   // JSON incompleto

  const status = data['status'];
  if (status === 'hello') {
    protocol = Number(data['protocol'] ?? 1);
    retryMs  = RETRY_MIN_MS;
    lastExit = '';
    smtcLog(`SmtcNative listo (protocolo ${protocol})`);
    if (spectrumWanted) sendCommand('spectrum on');   // el exe se relanzó: volver a pedirlo
  } else if (status === 'spectrum') {
    if (Array.isArray(data['bands'])) {
      spectrumBands = (data['bands'] as unknown[]).map(Number);
      spectrumAt    = Date.now();
    }
  } else if (status === 'volume') {
    const level = Number(data['level']);
    for (const resolve of volumeWaiters.splice(0)) resolve(Number.isNaN(level) ? null : level);
  } else if (status === 'ok') {
    if (protocol < 2) { retryMs = RETRY_MIN_MS; lastExit = ''; }
    // v1 no manda thumbChanged → la portada viene en cada línea
    if (data['thumbChanged'] !== false) {
      thumbnail = typeof data['thumbnail'] === 'string' ? data['thumbnail'] : null;
    }
    // Usar el timestamp del exe (más preciso que Date.now() aquí por el delay del pipe)
    posReadAt = typeof data['positionTs'] === 'number' ? data['positionTs'] : Date.now();
    current = {
      title:           String(data['title']     ?? ''),
      artist:          String(data['artist']    ?? ''),
      album:           String(data['album']     ?? ''),
      thumbnailBase64: thumbnail,
      isPlaying:       data['isPlaying'] === true,
      position:        Number(data['position']  ?? 0),
      duration:        Number(data['duration']  ?? 0),
      source:          String(data['source']    ?? ''),
    };
  } else if (status === 'no_media') {
    current   = null;
    thumbnail = null;
  }
  // 'error' → keep last known state
}

// ─── Control de reproducción ──────────────────────────────────────────────────

/** v2: manda un comando al proceso que ya está corriendo. false si no se pudo. */
function sendCommand(command: string): boolean {
  if (protocol >= 2 && loopProc?.stdin?.writable) {
    loopProc.stdin.write(`${command}\n`);
    return true;
  }
  return false;
}

export function smtcControl(action: ControlAction): Promise<void> {
  // v2: sin arrancar .NET de nuevo; v1: un proceso por comando
  if (sendCommand(action)) return Promise.resolve();
  return runControlProcess([action]);
}

export function smtcSeekBy(seconds: number): Promise<void> {
  const arg = seconds.toFixed(2);
  if (sendCommand(`seekBy ${arg}`)) return Promise.resolve();
  return runControlProcess(['seekBy', arg]);
}

/** Cambia el volumen del sistema; resuelve con el nivel nuevo (0–1), o null si no hubo respuesta. */
export function smtcVolumeBy(delta: number): Promise<number | null> {
  return new Promise((resolve) => {
    if (!sendCommand(`volumeBy ${delta.toFixed(3)}`)) { resolve(null); return; }
    const timer = setTimeout(() => {
      const i = volumeWaiters.indexOf(done);
      if (i >= 0) volumeWaiters.splice(i, 1);
      resolve(null);
    }, 1_000);
    function done(level: number | null): void { clearTimeout(timer); resolve(level); }
    volumeWaiters.push(done);
  });
}

/** Activa/desactiva la captura de audio para el visualizador (solo si cambia). */
export function smtcSetSpectrum(on: boolean): void {
  if (on === spectrumWanted) return;
  spectrumWanted = on;
  if (!on) spectrumBands = null;
  sendCommand(on ? 'spectrum on' : 'spectrum off');
}

/** Bandas del espectro (0–1) si llegaron hace poco; null si no hay datos. */
export function getSmtcSpectrum(): number[] | null {
  return spectrumBands && Date.now() - spectrumAt < 500 ? spectrumBands : null;
}

function runControlProcess(args: string[]): Promise<void> {
  return new Promise<void>((resolve) => {
    const exePath = findExe();
    if (!exePath) { resolve(); return; }

    const ctrl = execFile(exePath, args, { timeout: 5000 }, () => resolve());
    ctrl.on('error', () => resolve());
  });
}
