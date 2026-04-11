import { action, SingletonAction } from '@elgato/streamdeck';
import type { KeyDownEvent, DialDownEvent, WillAppearEvent } from '@elgato/streamdeck';
import { mediaManager } from '../providers/media-manager';

@action({ UUID: 'dev.camiloseguro.musicdeck.playpause' })
export class PlayPauseAction extends SingletonAction {
  constructor() {
    super();
    mediaManager.onMediaChange(() => void this.refresh());
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const media = mediaManager.getCurrent();
    if (ev.action.isKey()) {
      await ev.action.setTitle(media?.isPlaying ? '⏸' : '▶');
    } else {
      await ev.action.setFeedback({ title: media?.isPlaying ? 'Pause' : 'Play' });
    }
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await mediaManager.control('togglePlay');
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    await mediaManager.control('togglePlay');
  }

  private async refresh(): Promise<void> {
    try {
      const media  = mediaManager.getCurrent();
      const label  = media?.isPlaying ? '⏸' : '▶';
      // SingletonAction expone this.action cuando hay una instancia activa
      // @ts-expect-error — acceso interno al contexto de SingletonAction
      const ctx = this['context'] as any;
      if (!ctx) return;

      if (ctx.isKey?.()) {
        await ctx.setTitle(label);
      } else {
        await ctx.setFeedback({ title: media?.isPlaying ? 'Pause' : 'Play' });
      }
    } catch { /* sin instancia activa */ }
  }
}
