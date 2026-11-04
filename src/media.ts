import { isSupportedRate, MAX_RATE, MIN_RATE, sameRate, videoKey } from './rate';

export interface PageSession {
  /** Temporary choice for one video and its parts. Only a pin crosses videos. */
  rate: number | null;
  videoKey?: string;
  manuallySelected?: boolean;
  /** A reused player must use neutral 1x after the removed pin, not BPX's stale default. */
  resetAfterUnpin?: boolean;
}

/** Called before both route reconciliation and media callbacks, regardless of their order. */
export function updateSessionVideo(session: PageSession, key: string): void {
  if (session.videoKey !== undefined && session.videoKey !== key) {
    session.rate = 1;
    session.manuallySelected = false;
    session.resetAfterUnpin = false;
  }
  session.videoKey = key;
}

export class MediaController {
  video: HTMLVideoElement | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private nativeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onRateChange = () => this.onChange();
  private recoveringMedia = false;
  private revision = 0;

  get generation(): number { return this.revision; }
  get chosenRate(): number | null { return this.session.rate; }

  /** Temporary keyboard speed must never become a page choice or saved pin. */
  transient(rate: number): boolean {
    const video = this.video;
    if (!video || !isSupportedRate(rate)) return false;
    if (sameRate(video.playbackRate, rate)) return true;
    try {
      video.playbackRate = rate;
      if (!sameRate(video.playbackRate, rate)) throw new Error('Temporary rate was rejected');
    }
    catch { this.onError('播放器暂时无法设置临时倍速。'); return false; }
    this.onChange();
    return true;
  }
  private readonly onLoadStart = () => {
    this.cancelRestore();
    this.prepareMedia();
  };
  private readonly onReady = (event: Event) => {
    if (this.session.videoKey !== this.currentVideoKey()) this.prepareMedia();
    if (!this.recoveringMedia) return;
    this.restore();
    // A slow BPX startup can set its rate after metadata. Recover at actual
    // readiness too, then retire this recovery before later pause/resume.
    if (event.type === 'playing') this.recoveringMedia = false;
  };

  constructor(
    private readonly session: PageSession,
    private readonly onChange: () => void,
    private readonly onError: (message: string) => void,
    private readonly resolveVideo?: () => HTMLVideoElement | null,
    private readonly getPinnedRate: () => number | null = () => null,
  ) {}

  bind(video: HTMLVideoElement | null): void {
    if (this.video === video) return;
    this.unbind();
    this.video = video;
    if (video) {
      this.prepareMedia();
      video.addEventListener('ratechange', this.onRateChange);
      video.addEventListener('loadstart', this.onLoadStart);
      video.addEventListener('emptied', this.onLoadStart);
      for (const type of ['loadedmetadata', 'loadeddata', 'canplay', 'playing']) {
        video.addEventListener(type, this.onReady);
      }
      if (this.session.rate !== null) this.restore();
    }
    this.onChange();
  }

  apply(rate: number): boolean {
    updateSessionVideo(this.session, this.currentVideoKey());
    if (this.resolveVideo) this.bind(this.resolveVideo());
    this.cancelRestore();
    clearTimeout(this.nativeTimer);
    const video = this.video;
    if (!video || !isSupportedRate(rate)) {
      this.onError(video ? `倍速范围为 ${MIN_RATE}–${MAX_RATE}。` : '播放器尚未就绪，请稍后重试。');
      return false;
    }
    try {
      video.playbackRate = rate;
      if (!sameRate(video.playbackRate, rate)) throw new Error('Rate was not accepted');
    } catch {
      this.onError('播放器暂时无法设置该倍速，请稍后重试。');
      this.onChange();
      return false;
    }
    this.revision++;
    this.session.rate = rate;
    this.session.manuallySelected = true;
    this.session.resetAfterUnpin = false;
    this.onChange();
    this.restore();
    return true;
  }

  /** Let Bilibili handle its original item, then remember what it actually applied. */
  nativeSelection(requested: number): void {
    updateSessionVideo(this.session, this.currentVideoKey());
    this.revision++;
    this.cancelRestore();
    clearTimeout(this.nativeTimer);
    const selectedVideo = this.video;
    const selectedGeneration = this.revision;
    const selectedKey = this.currentVideoKey();
    if (isSupportedRate(requested)) {
      this.session.rate = requested;
      this.session.manuallySelected = true;
      this.session.resetAfterUnpin = false;
    }
    // Microtasks can run between capture and bubble listeners. Wait for the
    // complete native click dispatch, then read back the rate it really applied.
    this.nativeTimer = setTimeout(() => {
      if (!selectedVideo || this.video !== selectedVideo || this.revision !== selectedGeneration
        || this.currentVideoKey() !== selectedKey) return;
      const actual = selectedVideo.playbackRate;
      if (isSupportedRate(actual)) this.session.rate = actual;
      this.onChange();
    }, 0);
  }

  /** Apply an asynchronously loaded default only before a deliberate selection. */
  initializePin(): void {
    if (this.session.manuallySelected) return;
    this.prepareMedia();
    this.restore();
  }

  /** Forget the removed default without changing the already-playing video. */
  pinChanged(previous: number | null, current: number | null): void {
    this.cancelRestore();
    if (previous === null || current !== null) return;
    clearTimeout(this.nativeTimer);
    this.session.rate = null;
    this.session.resetAfterUnpin = true;
    // BPX native choices set BOTH playbackRate and defaultPlaybackRate. The
    // latter otherwise silently carries 0.5x (etc.) into a reused video.
    // Releasing a pin changes only the next video's default, never this rate.
    this.clearNativeDefault();
  }

  navigate(): void {
    this.prepareMedia();
    this.restore();
  }

  private prepareMedia(): void {
    updateSessionVideo(this.session, this.currentVideoKey());
    this.revision++;
    clearTimeout(this.nativeTimer);
    this.recoveringMedia = true;
    const pinned = this.getPinnedRate();
    if (pinned !== null) {
      this.session.rate = pinned;
      this.session.resetAfterUnpin = false;
    } else if (this.session.resetAfterUnpin) {
      this.session.rate = 1;
      this.session.resetAfterUnpin = false;
    }
    // Reused BPX players can carry a native choice in defaultPlaybackRate even
    // without ever pinning it. Release that default at a media/route boundary.
    if (pinned === null && this.session.rate !== null) this.clearNativeDefault();
  }

  restore(): void {
    this.cancelRestore(false);
    if (!this.video || this.session.rate === null) return;
    const boundVideo = this.video;
    const key = this.currentVideoKey();
    const releaseDefault = this.recoveringMedia && this.getPinnedRate() === null;
    // Bounded lifecycle recovery, never an endless ratechange -> write loop.
    // User interaction cancels these timers immediately.
    for (const delay of [0, 100, 400, 1000]) {
      this.timers.push(setTimeout(() => {
        const rate = this.session.rate;
        if (this.video !== boundVideo || !boundVideo.isConnected || rate === null
          || this.currentVideoKey() !== key) return;
        if (releaseDefault) this.clearNativeDefault();
        try {
          if (!sameRate(boundVideo.playbackRate, rate)) boundVideo.playbackRate = rate;
          if (delay === 1000 && !sameRate(boundVideo.playbackRate, rate)) {
            this.onError('播放器未能保持倍速，请重新选择。');
          }
        } catch {
          if (delay === 1000) this.onError('播放器未能保持倍速，请重新选择。');
        }
        this.onChange();
      }, delay));
    }
  }

  cancelRestore(stopRecovery = true): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (stopRecovery) this.recoveringMedia = false;
  }

  private clearNativeDefault(): void {
    const video = this.video;
    if (!video) return;
    const current = video.playbackRate;
    try {
      video.defaultPlaybackRate = 1;
      if (!sameRate(video.playbackRate, current)) video.playbackRate = current;
    } catch { /* The next lifecycle still explicitly restores the neutral 1x. */ }
  }

  private currentVideoKey(): string { return videoKey(location.href); }

  destroy(): void {
    this.unbind();
  }

  private unbind(): void {
    this.revision++;
    this.cancelRestore();
    clearTimeout(this.nativeTimer);
    this.video?.removeEventListener('ratechange', this.onRateChange);
    this.video?.removeEventListener('loadstart', this.onLoadStart);
    this.video?.removeEventListener('emptied', this.onLoadStart);
    for (const type of ['loadedmetadata', 'loadeddata', 'canplay', 'playing']) {
      this.video?.removeEventListener(type, this.onReady);
    }
    this.video = null;
  }
}
