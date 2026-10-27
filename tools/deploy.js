/**
 * deploy.js — copia el plugin compilado a la carpeta de plugins de StreamDock.
 *
 *   node tools/deploy.js            copia bin/, manifest, imgs/ y scripts/
 *   node tools/deploy.js --restart  además reinicia el proceso del plugin
 *                                   (StreamDock lo vuelve a lanzar solo)
 *
 * bin/ se reemplaza completo (para no dejar archivos viejos); imgs/ y scripts/
 * se mezclan, así no se borra un SmtcNative.exe ya compilado en el destino.
 */
const { cpSync, existsSync, rmSync, statSync } = require('fs');
const { join }     = require('path');
const { homedir }  = require('os');
const { execSync } = require('child_process');

const PLUGIN_ID = 'dev.camiloseguro.musicdeck.sdPlugin';
const SRC       = join(__dirname, '..', PLUGIN_ID);
const isWin     = process.platform === 'win32';
const restart   = process.argv.includes('--restart');

const pluginsDir = isWin
  ? join(process.env.APPDATA ?? '', 'HotSpot', 'StreamDock', 'plugins')
  : join(homedir(), 'Library', 'Application Support', 'HotSpot', 'StreamDock', 'plugins');
const DEST = join(pluginsDir, PLUGIN_ID);

if (!existsSync(join(SRC, 'bin', 'plugin.js'))) {
  console.error('No hay build: corre `npm run build` primero.');
  process.exit(1);
}
if (!existsSync(pluginsDir)) {
  console.error(`No existe la carpeta de plugins de StreamDock: ${pluginsDir}`);
  process.exit(1);
}

// En Windows un .exe en ejecución no se puede sobrescribir: parar antes de copiar
const stoppedPid = restart && isWin ? stopWindows() : '';

// scripts/ primero: si StreamDock relanza el plugin enseguida, el exe ya es el nuevo
try {
  cpSync(join(SRC, 'scripts'), join(DEST, 'scripts'), {
    recursive: true,
    // Saltar obj/ y archivos sin cambios (copiar un exe/dll en uso falla en Windows)
    filter: (src, dest) => !/[\\/]SmtcNative[\\/]obj([\\/]|$)/.test(src) && !unchanged(src, dest),
  });
} catch (err) {
  console.error(`No se pudo copiar scripts/ (¿SmtcNative.exe en uso? usa --restart): ${err.message}`);
}
rmSync(join(DEST, 'bin'), { recursive: true, force: true });
cpSync(join(SRC, 'bin'), join(DEST, 'bin'), { recursive: true });
cpSync(join(SRC, 'manifest.json'), join(DEST, 'manifest.json'));
cpSync(join(SRC, 'package.json'),  join(DEST, 'package.json'));
cpSync(join(SRC, 'imgs'),    join(DEST, 'imgs'),    { recursive: true });
cpSync(join(SRC, 'propertyInspector'), join(DEST, 'propertyInspector'), { recursive: true });
console.log(`Copiado a ${DEST}`);

if (!existsSync(join(DEST, 'node_modules'))) {
  console.log('Instalando dependencias en el destino...');
  execSync('npm install --omit=dev', { cwd: DEST, stdio: 'inherit' });
}

if (restart) {
  try {
    if (isWin) waitForRelaunchWindows(stoppedPid);
    else {
      execSync(`pkill -f '${PLUGIN_ID}/bin/plugin.js' || true`, { stdio: 'inherit' });
      console.log('Plugin reiniciado (StreamDock lo relanza en unos segundos).');
    }
  } catch (err) {
    console.error('No se pudo reiniciar el plugin:', err.message);
  }
}

/** Mismo tamaño y no más nuevo que el destino → no hace falta copiarlo. */
function unchanged(src, dest) {
  try {
    const s = statSync(src), d = statSync(dest);
    return s.isFile() && s.size === d.size && s.mtimeMs <= d.mtimeMs;
  } catch {
    return false;
  }
}

// ─── Windows ──────────────────────────────────────────────────────────────────

function ps(cmd) {
  return execSync(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

function pluginPid() {
  const match = PLUGIN_ID.replace(/\./g, '\\.');
  return ps(
    `(Get-CimInstance Win32_Process -Filter "Name like 'node%'" | Where-Object CommandLine -match '${match}' | Select-Object -First 1).ProcessId`,
  );
}

/** Mata el proceso del plugin y los SmtcNative.exe de la carpeta instalada. Devuelve el PID del plugin. */
function stopWindows() {
  const pid = pluginPid();
  if (pid) ps(`Stop-Process -Id ${pid} -Force`);
  const exeDir = join(DEST, 'scripts', 'SmtcNative').replace(/'/g, "''");
  ps(`Get-Process SmtcNative -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${exeDir}*' } | Stop-Process -Force; Start-Sleep -Milliseconds 500`);
  return pid;
}

/**
 * Espera a que VSD Craft relance el plugin. VSD Craft no siempre lo hace
 * (p. ej. tras varios reinicios seguidos); en ese caso se reinicia VSD Craft completo.
 */
function waitForRelaunchWindows(before) {
  const VSD = 'C:\\Program Files (x86)\\VSD Craft\\VSD Craft.exe';

  for (let i = 0; i < 15; i++) {
    ps('Start-Sleep -Seconds 1');
    const pid = pluginPid();
    if (pid && pid !== before) { console.log(`Plugin reiniciado (PID ${pid}).`); return; }
  }

  console.log('VSD Craft no relanzó el plugin; reiniciando VSD Craft...');
  ps(`Get-Process 'VSD Craft' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 3; Start-Process '${VSD}' -ArgumentList '--RunInBackground'`);
  console.log('VSD Craft reiniciado.');
}
