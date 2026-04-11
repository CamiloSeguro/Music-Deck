import { action, SingletonAction } from '@elgato/streamdeck';
import type { KeyDownEvent, DialDownEvent, DialRotateEvent } from '@elgato/streamdeck';
import { mediaManager } from '../providers/media-manager';

@action({ UUID: 'dev.camiloseguro.musicdeck.next' })
export class NextTrackAction extends SingletonAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await mediaManager.control('next');
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    await mediaManager.control('next');
  }

  /** Girar hacia la derecha → siguiente */
  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (ev.payload.ticks > 0) {
      await mediaManager.control('next');
    } else {
      await mediaManager.control('previous');
    }
  }
}
