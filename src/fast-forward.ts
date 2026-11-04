import { MediaController } from './media';
import { fastForwardRate, formatRate, isSupportedRate } from './rate';

const HINT = '.bpx-player-three-playrate-hint';
interface Hold {
  video: HTMLVideoElement;
  source: string;
  url: string;
  generation: number;
  original: number;
  temporary: number;
  active: boolean;
  released: boolean;
  interrupted: boolean;
}

/** Observe the native long-press signal; leave short-arrow seeking to Bilibili. */
export class FastForwardController {
  private hold: Hold | undefined;
  private hint: HTMLElement | null = null;
  private label: HTMLSpanElement | undefined;
  private readonly observer = new MutationObserver(() => this.sync());
  private readonly events = new AbortController();
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly root: HTMLElement, private readonly media: MediaController) {
    const signal = this.events.signal;
    window.addEventListener('keydown', this.onDown, { capture: true, signal });
    window.addEventListener('keyup', this.onUp, { capture: true, signal });
    window.addEventListener('blur', this.onBlur, { signal });
    document.addEventListener('visibilitychange', this.onVisibility, { signal });
    root.addEventListener('emptied', this.onSourceChange, { capture: true, signal });
    root.addEventListener('loadstart', this.onSourceChange, { capture: true, signal });
  }

  sync(): void {
    const hold = this.hold;
    if (!hold) return;
    if (!this.sameMedia(hold)) { this.cancel(); return; }
    if (this.media.generation !== hold.generation) {
      // An explicit menu selection during a hold supersedes the old snapshot.
      // Still correct the native release, which remembers the pre-hold rate.
      hold.generation = this.media.generation;
      hold.original = this.media.chosenRate ?? hold.video.playbackRate;
      hold.interrupted = true;
      this.removeLabel();
    }
    if (hold.released) return;
    const hint = this.root.querySelector<HTMLElement>(HINT);
    if (hint !== this.hint) {
      this.removeLabel();
      this.hint = hint;
      this.observe();
    }
    // A 300ms timer alone is insufficient: login prompts, editable fields or
    // native settings may reject the shortcut. Only a visible native hint arms it.
    if (!hint || hint.getClientRects().length === 0
      || getComputedStyle(hint).visibility === 'hidden') return;
    hold.active = true;
    if (hold.interrupted) return;
    if (!this.label) {
      this.label = document.createElement('span');
      this.label.dataset.bs4FastforwardLabel = '';
      this.label.textContent = `${formatRate(hold.temporary)}倍播放中`;
      hint.dataset.bs4Fastforward = '';
      hint.append(this.label);
    }
    if (!this.media.transient(hold.temporary)) {
      hold.interrupted = true;
      this.removeLabel();
    }
  }

  cancel(): void {
    this.hold = undefined;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.observer.disconnect();
    this.removeLabel();
    this.hint = null;
  }

  destroy(): void {
    this.cancel();
    this.events.abort();
  }

  private valid(hold: Hold): boolean {
    return this.sameMedia(hold) && this.media.generation === hold.generation;
  }

  private sameMedia(hold: Hold): boolean {
    return this.root.isConnected && this.media.video === hold.video && hold.video.isConnected
      && hold.video.currentSrc === hold.source
      && location.href === hold.url;
  }

  private observe(): void {
    this.observer.disconnect();
    if (this.hint) this.observer.observe(this.hint, { attributes: true, attributeFilter: ['style', 'class'] });
    else this.observer.observe(this.root, { childList: true, subtree: true });
  }

  private removeLabel(): void {
    this.label?.remove();
    this.label = undefined;
    if (this.hint) delete this.hint.dataset.bs4Fastforward;
  }

  private release(keepForLateKeyUp = false): void {
    this.sync();
    const hold = this.hold;
    if (!hold) return;
    if (!hold.active || !this.valid(hold)) { this.cancel(); return; }
    hold.released = true;
    this.observer.disconnect();
    this.removeLabel();
    this.timers.forEach(clearTimeout);
    // Let the native keyup/blur handlers finish their (4x-clamped) restoration.
    // Retry only in this short release window; never lock the normal ratechange.
    this.timers = [0, 50, 150].map(delay => setTimeout(() => {
      if (this.hold !== hold) return;
      if (!this.valid(hold)) { this.cancel(); return; }
      if (!this.media.transient(hold.original)) { this.cancel(); return; }
      if (delay === 150 && !keepForLateKeyUp) this.cancel();
    }, delay));
  }

  private readonly onDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowRight' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!(event.target instanceof Element)
      || event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-bs4-custom]')) return;
    if (this.hold && !this.hold.released) return;
    // Recover a previous blurred hold before taking a fresh snapshot.
    if (this.hold?.active && this.valid(this.hold)) this.media.transient(this.hold.original);
    this.cancel();
    const video = this.media.video;
    if (!this.root.isConnected || !video?.isConnected || !isSupportedRate(video.playbackRate)) return;
    this.media.cancelRestore();
    this.hold = { video, source: video.currentSrc, url: location.href, generation: this.media.generation,
      original: video.playbackRate, temporary: fastForwardRate(video.playbackRate), active: false, released: false, interrupted: false };
    this.hint = this.root.querySelector(HINT);
    this.observe();
  };

  private readonly onUp = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowRight') this.release();
  };

  private readonly onBlur = (): void => this.release(true);
  private readonly onVisibility = (): void => { if (document.hidden) this.release(true); };
  private readonly onSourceChange = (): void => this.cancel();
}
