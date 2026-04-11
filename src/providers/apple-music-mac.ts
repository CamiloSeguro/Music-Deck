/**
 * apple-music-mac.ts
 * Lee y controla Apple Music en macOS via AppleScript.
 * Solo se usa cuando el plugin corre en Mac (platform() === 'darwin').
 */
import { exec } from 'child_process';
import type { MediaInfo, ControlAction } from '../types';

function runScript(script: string): Promise<string> {
  // Limpiar el script para pasarlo como -e multi-línea
  const clean = script.trim().replace(/\n\s+/g, '\n');
  return new Promise((resolve, reject) => {
    exec(`osascript << 'APPLESCRIPT'\n${clean}\nAPPLESCRIPT`, { timeout: 3000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
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
            set st to (player state is playing)
            return t & "|" & ar & "|" & al & "|" & po & "|" & du & "|" & st
          end if
        end if
        return ""
      end tell
    `);

    if (!result) return null;

    const parts = result.split('|');
    if (parts.length < 6) return null;

    return {
      title:           parts[0] ?? '',
      artist:          parts[1] ?? '',
      album:           parts[2] ?? '',
      thumbnailBase64: null,   // AppleScript no expone artwork fácilmente
      isPlaying:       parts[5] === 'true',
      position:        parseFloat(parts[3] ?? '0') || 0,
      duration:        parseFloat(parts[4] ?? '0') || 0,
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
