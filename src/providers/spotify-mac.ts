/**
 * spotify-mac.ts
 * Lee y controla Spotify en macOS via AppleScript.
 * Solo se usa cuando el plugin corre en Mac (platform() === 'darwin').
 * La portada se obtiene de la URL que expone el propio Spotify y se cachea por URL.
 *
 * Nota: en Spotify, `duration of current track` devuelve milisegundos;
 * `player position` devuelve segundos.
 */
import { exec } from 'child_process';
import * as https from 'https';
import * as http from 'http';
import type { MediaInfo, ControlAction } from '../types';

let artCache: { url: string; base64: string | null } = { url: '', base64: null };
let artFetchUrl = ''; // guard contra fetches concurrentes de la misma URL

function runScript(script: string): Promise<string> {
  const clean = script.trim().replace(/\n\s+/g, '\n');
  return new Promise((resolve, reject) => {
    exec(`osascript << 'APPLESCRIPT'\n${clean}\nAPPLESCRIPT`, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

function fetchImageBase64(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 5000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function fetchArtwork(url: string): Promise<string | null> {
  if (!url) return null;
  if (artCache.url === url) return artCache.base64;
  if (artFetchUrl === url) return null; // fetch en vuelo

  artFetchUrl = url;
  const base64 = await fetchImageBase64(url);
  artCache = { url, base64 };
  return base64;
}

export async function getSpotifyInfo(): Promise<MediaInfo | null> {
  try {
    const result = await runScript(`
      tell application "Spotify"
        if it is running then
          if player state is playing or player state is paused then
            set t      to name of current track
            set ar     to artist of current track
            set al     to album of current track
            set po     to player position
            set du     to duration of current track
            set isPlay to "false"
            if player state is playing then set isPlay to "true"
            set artUrl to artwork url of current track
            return t & "|" & ar & "|" & al & "|" & (po as string) & "|" & (du as string) & "|" & isPlay & "|" & artUrl
          end if
        end if
        return ""
      end tell
    `);

    if (!result) return null;

    const parts = result.split('|');
    if (parts.length < 7) return null;

    const artUrl = parts[6] ?? '';
    const thumbnailBase64 = await fetchArtwork(artUrl);

    // macOS en español usa coma como separador decimal — normalizar antes de parsear
    const parseNum = (s: string) => parseFloat((s ?? '0').replace(',', '.')) || 0;

    // Spotify duration está en milisegundos; player position en segundos
    const durationMs = parseNum(parts[4] ?? '0');

    return {
      title:           parts[0] ?? '',
      artist:          parts[1] ?? '',
      album:           parts[2] ?? '',
      thumbnailBase64,
      isPlaying:       parts[5] === 'true',
      position:        parseNum(parts[3] ?? '0'),
      duration:        durationMs / 1000,
      source:          'Spotify',
    };
  } catch {
    return null;
  }
}

export async function spotifyControl(action: ControlAction): Promise<void> {
  const commands: Record<ControlAction, string> = {
    play:       'tell application "Spotify" to play',
    pause:      'tell application "Spotify" to pause',
    togglePlay: 'tell application "Spotify" to playpause',
    next:       'tell application "Spotify" to next track',
    previous:   'tell application "Spotify" to previous track',
  };
  try {
    await runScript(commands[action]);
  } catch {
    // silencioso
  }
}
