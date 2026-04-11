import { action, SingletonAction } from '@elgato/streamdeck';
import type { KeyDownEvent, DialDownEvent } from '@elgato/streamdeck';
import { mediaManager } from '../providers/media-manager';

@action({ UUID: 'dev.camiloseguro.musicdeck.previous' })
export class PreviousTrackAction extends SingletonAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await mediaManager.control('previous');
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    await mediaManager.control('previous');
  }
}
