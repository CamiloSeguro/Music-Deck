/**
 * apple-music-mac.ts
 * Lee y controla Apple Music en macOS via AppleScript.
 * Solo se usa cuando el plugin corre en Mac (platform() === 'darwin').
 * Incluye portada de álbum: AppleScript escribe los bytes crudos a un archivo
 * temporal y Node.js lo lee y codifica en base64 (cacheado por título+artista).
 */
import { exec } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import type { MediaInfo, ControlAction } from '../types';

const ART_TMP = '/tmp/musicdeck_apple_art';

let artCache: { key: string; base64: string | null } = { key: '', base64: null };
let artFetchKey = '';  // guard contra fetches concurrentes del mismo track

function runScript(script: string): Promise<string> {
  const clean = script.trim().replace(/\n\s+/g, '\n');
  return new Promise((resolve, reject) => {
    exec(`osascript << 'APPLESCRIPT'\n${clean}\nAPPLESCRIPT`, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

async function fetchArtwork(trackKey: string): Promise<string | null> {
  if (artCache.key === trackKey) return artCache.base64;
  if (artFetchKey === trackKey) return null; // ya hay un fetch en vuelo para este track

  artFetchKey = trackKey;
  try {
    try { unlinkSync(ART_TMP); } catch { /* ok si no existe */ }

    await runScript(`
      tell application "Music"
        if it is running then
          if player state is playing or player state is paused then
            try
              set artData to data of artwork 1 of current track
              set theFile to open for access POSIX file "${ART_TMP}" with write permission
              set eof of theFile to 0
              write artData to theFile
              close access theFile
            end try
          end if
        end if
      end tell
    `);

    let base64: string | null = null;
    if (existsSync(ART_TMP)) {
      base64 = readFileSync(ART_TMP).toString('base64');
    }
    artCache = { key: trackKey, base64 };
    return base64;
  } catch {
    artCache = { key: trackKey, base64: null };
    return null;
  }
}

export async function getAppleMusicInfo(): Promise<MediaInfo | null> {
  try {
    const result = await runScript(`
      tell application "Music"
        if it is running then
          if player state is playing or player state is paused then
            set t  to name of current track
            set ar to artist of current track
            set al to album of current track
            set po to player position
            set du to duration of current track
            set isPlay to "false"
            if player state is playing then set isPlay to "true"
            return t & "|" & ar & "|" & al & "|" & (po as string) & "|" & (du as string) & "|" & isPlay
          end if
        end if
        return ""
      end tell
    `);

    if (!result) return null;

    const parts = result.split('|');
    if (parts.length < 6) return null;

    // macOS en español usa coma como separador decimal — normalizar antes de parsear
    const parseNum = (s: string) => parseFloat((s ?? '0').replace(',', '.')) || 0;

    const title  = parts[0] ?? '';
    const artist = parts[1] ?? '';
    const thumbnailBase64 = await fetchArtwork(`${title}::${artist}`);

    return {
      title,
      artist,
      album:           parts[2] ?? '',
      thumbnailBase64,
      isPlaying:       parts[5] === 'true',
      position:        parseNum(parts[3] ?? '0'),
      duration:        parseNum(parts[4] ?? '0'),
      source:          'Apple Music',
    };
  } catch {
    return null;
  }
}

export async function appleMusicControl(action: ControlAction): Promise<void> {
  const commands: Record<ControlAction, string> = {
    play:       'tell application "Music" to play',
    pause:      'tell application "Music" to pause',
    togglePlay: 'tell application "Music" to playpause',
    next:       'tell application "Music" to next track',
    previous:   'tell application "Music" to previous track',
  };
  try {
    await runScript(commands[action]);
  } catch {
    // silencioso
  }
}
