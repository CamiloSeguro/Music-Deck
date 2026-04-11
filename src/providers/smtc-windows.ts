/**
 * smtc-windows.ts
 *
 * Uses a pre-compiled .NET 10 console app (SmtcNative.exe) to read Windows SMTC.
 * The exe handles WinRT async correctly — PowerShell 5.1 cannot.
 *
 * Loop mode: SmtcNative.exe (no args) writes one JSON line per second to stdout.
 * Control mode: SmtcNative.exe <action> sends command and exits.
 *
 * The exe is at: scripts/SmtcNative/bin/Release/net10.0-windows10.0.19041.0/SmtcNative.exe
 * If the exe is missing, startSmtcLoop() will attempt to build it via `dotnet build`.
 */

import { spawn, execFile, type ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, appendFileSync } from 'fs';
import type { MediaInfo, ControlAction } from '../types';

function smtcLog(msg: string): void {
  try { appendFileSync(join(__dirname, '..', '..', 'debug.log'), `[${new Date().toISOString()}] [SMTC] ${msg}\n`); } catch { /* noop */ }
}

// ─── Paths ────────────────────────────────────────────────────────────────────

// __dirname = <plugin>/bin/providers/ → subir dos niveles para llegar al plugin root
const SCRIPTS_DIR = join(__dirname, '..', '..', 'scripts');
const CSPROJ      = join(SCRIPTS_DIR, 'SmtcNative', 'SmtcNative.csproj');

/** Finds the SmtcNative.exe — searches for the release build directory. */
function findExe(): string | null {
  const base = join(SCRIPTS_DIR, 'SmtcNative', 'bin', 'Release');
  if (!existsSync(base)) return null;

  // Look for any net*-windows* subdirectory
  const { readdirSync } = require('fs') as typeof import('fs');
  try {
    for (const tfm of readdirSync(base)) {
      if (!tfm.startsWith('net') || !tfm.includes('windows')) continue;
      const candidate = join(base, tfm, 'SmtcNative.exe');
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* ignore */ }
  return null;
}

// ─── Estado interno ───────────────────────────────────────────────────────────

let loopProc:    ChildProcess | null = null;
let lineBuffer = '';
let stopped    = false;
let current:   MediaInfo | null = null;
let posReadAt  = 0;   // ms UTC de cuando SmtcNative leyó la posición (positionTs del JSON)

// ─── Build helper ─────────────────────────────────────────────────────────────

function buildExe(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.error('[SMTC] Compilando SmtcNative.exe (primera vez, puede tomar unos segundos)...');
    const proc = execFile(
      'dotnet',
      ['build', CSPROJ, '-c', 'Release', '--nologo', '-v', 'q'],
      { timeout: 60_000 },
      (err, _stdout, stderr) => {
        if (err) {
          console.error('[SMTC] Error compilando SmtcNative:', stderr);
          reject(err);
        } else {
          console.error('[SMTC] SmtcNative.exe compilado correctamente.');
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
  launchLoop();
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

async function launchLoop(): Promise<void> {
  if (stopped) return;

  let exePath = findExe();
  smtcLog(`launchLoop exePath=${exePath ?? 'null'}`);

  if (!exePath) {
    try {
      await buildExe();
      exePath = findExe();
    } catch {
      smtcLog('No se pudo compilar SmtcNative.exe. Sin datos de media.');
      return;
    }
  }

  if (!exePath || stopped) return;
  smtcLog(`spawning ${exePath}`);

  loopProc = spawn(exePath, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  loopProc.stdout?.setEncoding('utf8');
  loopProc.stdout?.on('data', (chunk: string) => {
    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    lineBuffer  = lines.pop() ?? '';

    for (const line of lines) {
      const raw = line.trim();
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (data['status'] === 'ok') {
          // Usar el timestamp del exe (más preciso que Date.now() aquí por el delay del pipe)
          posReadAt = typeof data['positionTs'] === 'number' ? data['positionTs'] : Date.now();
          current = {
            title:           String(data['title']     ?? ''),
            artist:          String(data['artist']    ?? ''),
            album:           String(data['album']     ?? ''),
            thumbnailBase64: typeof data['thumbnail'] === 'string' ? data['thumbnail'] : null,
            isPlaying:       data['isPlaying'] === true,
            position:        Number(data['position']  ?? 0),
            duration:        Number(data['duration']  ?? 0),
            source:          String(data['source']    ?? ''),
          };
        } else if (data['status'] === 'no_media') {
          current = null;
        }
        // 'error' → keep last known state
      } catch { /* incomplete JSON, ignore */ }
    }
  });

  loopProc.stderr?.on('data', (chunk: Buffer) => {
    smtcLog(chunk.toString().trim());
  });

  loopProc.on('exit', (code) => {
    loopProc = null;
    smtcLog(`SmtcNative terminó (código ${String(code)})`);
    if (!stopped) {
      setTimeout(() => void launchLoop(), 3_000);
    }
  });

  loopProc.on('error', (err) => {
    smtcLog(`Error al lanzar SmtcNative.exe: ${err.message}`);
  });
}

// ─── Control de reproducción ──────────────────────────────────────────────────

export function smtcControl(action: ControlAction): Promise<void> {
  return new Promise<void>((resolve) => {
    const exePath = findExe();
    if (!exePath) { resolve(); return; }

    const ctrl = execFile(
      exePath,
      [action],
      { timeout: 5000 },
      () => resolve(),
    );
    ctrl.on('error', () => resolve());
  });
}
