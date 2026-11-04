import { CONTROL, getMedia, MENU, PLAYER } from './adapter';
import { MediaController, type PageSession, updateSessionVideo } from './media';
import { SpeedMenu } from './menu';
import { PresetStore } from './presets';
import { isPlaybackPage, playbackKey, videoKey } from './rate';
import { FastForwardController } from './fast-forward';

class Player {
  private readonly menus = new Map<HTMLElement, SpeedMenu>();
  private readonly media: MediaController;
  private readonly fastForward: FastForwardController;
  private readonly observer: MutationObserver;
  private readonly resize: ResizeObserver;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private readonly unsubscribePin: () => void;

  constructor(readonly root: HTMLElement, session: PageSession, private readonly presets: PresetStore) {
    this.media = new MediaController(session,
      () => { this.fastForward?.sync(); this.menus.forEach(menu => menu.render()); },
      message => this.menus.forEach(menu => menu.message(message, true)),
      () => getMedia(this.root), () => this.presets.pinnedRate);
    this.fastForward = new FastForwardController(root, this.media);
    let pinned = presets.pinnedRate;
    this.unsubscribePin = presets.subscribe(() => {
      if (pinned === presets.pinnedRate) return;
      const previous = pinned;
      pinned = presets.pinnedRate;
      // Changing the default never forces another already-playing tab to switch.
      this.media.pinChanged(previous, pinned);
    });
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-value'] });
    this.resize = new ResizeObserver(() => this.resizeMenus());
    this.resize.observe(root);
    // A held key or a long press is a deliberate native interaction; do not
    // restore over Bilibili's temporary fast-forward mode.
    root.addEventListener('pointerdown', this.onInteraction, true);
    root.addEventListener('keydown', this.onInteraction, true);
    this.refresh();
  }

  refresh(): void {
    this.media.bind(getMedia(this.root));
    this.fastForward.sync();
    for (const [node, menu] of this.menus) {
      if (!this.root.contains(node) || !menu.control.contains(node)) {
        menu.destroy();
        this.menus.delete(node);
      }
    }
    for (const node of this.root.querySelectorAll<HTMLElement>(MENU)) {
      if (!node.closest(CONTROL)) continue;
      let view = this.menus.get(node);
      if (!view) {
        view = new SpeedMenu(node, this.media, this.presets);
        this.menus.set(node, view);
      } else view.ensure();
    }
    this.resizeMenus();
  }

  restore(): void { this.fastForward.cancel(); this.media.navigate(); }

  initializePin(): void { this.media.initializePin(); }

  destroy(): void {
    clearTimeout(this.scheduled);
    this.observer.disconnect();
    this.resize.disconnect();
    this.root.removeEventListener('pointerdown', this.onInteraction, true);
    this.root.removeEventListener('keydown', this.onInteraction, true);
    this.unsubscribePin();
    this.fastForward.destroy();
    this.media.destroy();
    this.menus.forEach(menu => menu.destroy());
    this.menus.clear();
  }

  private readonly onInteraction = (): void => this.media.cancelRestore();

  private schedule(): void {
    if (this.scheduled !== undefined) return;
    this.scheduled = setTimeout(() => {
      this.scheduled = undefined;
      this.refresh();
    }, 0);
  }

  private resizeMenus(): void {
    // BPX includes the danmaku bar in the container height. Use the actual
    // video area, or the first presets can protrude above its clipping edge.
    const area = this.root.querySelector<HTMLElement>('.bpx-player-video-wrap, .bpx-player-video-area') ?? this.root;
    const height = Math.max(100, area.getBoundingClientRect().height - 80);
    const value = `${Math.round(height)}px`;
    for (const node of this.menus.keys()) {
      if (node.style.getPropertyValue('--bs4-menu-height') !== value) {
        node.style.setProperty('--bs4-menu-height', value);
      }
    }
  }
}

export function startExtension(): () => void {
  const session: PageSession = { rate: null };
  const presets = new PresetStore();
  const players = new Map<HTMLElement, Player>();
  let lastUrl = location.href;
  let lastPlayback = playbackKey(lastUrl);
  let scheduled: ReturnType<typeof setTimeout> | undefined;

  const reconcile = () => {
    scheduled = undefined;
    const nextPlayback = playbackKey(location.href);
    const changedPage = lastPlayback !== nextPlayback;
    lastPlayback = nextPlayback;
    lastUrl = location.href;
    // Set the boundary before constructing a replacement/late player too.
    updateSessionVideo(session, videoKey(lastUrl));
    const supported = isPlaybackPage(location.pathname);
    for (const [root, player] of players) {
      if (!supported || !root.isConnected) {
        player.destroy();
        players.delete(root);
      }
    }
    if (!supported) { session.rate = null; return; }
    for (const root of document.querySelectorAll<HTMLElement>(PLAYER)) {
      if (!players.has(root)) players.set(root, new Player(root, session, presets));
      else if (changedPage) players.get(root)!.restore();
    }
  };
  const schedule = () => {
    if (scheduled === undefined) scheduled = setTimeout(reconcile, 0);
  };
  const observer = new MutationObserver(records => {
    if (location.href !== lastUrl || [...players.keys()].some(root => !root.isConnected)) {
      schedule();
      return;
    }
    if (!isPlaybackPage(location.pathname)) return;
    // Ignore normal mutations inside already-bound players; their local
    // observers handle those. Only root discovery runs at document level.
    for (const record of records) {
      if (record.target instanceof Element && record.target.closest(PLAYER)) continue;
      for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches(PLAYER) || node.querySelector(PLAYER))) {
          schedule();
          return;
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('pageshow', schedule);
  // Navigation API is optional: Firefox also gets route discovery from DOM
  // mutations and popstate, without patching the page's history functions.
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  navigation?.addEventListener('navigatesuccess', schedule);
  reconcile();
  void presets.ready.then(() => players.forEach(player => player.initializePin()));

  return () => {
    clearTimeout(scheduled);
    observer.disconnect();
    window.removeEventListener('popstate', schedule);
    window.removeEventListener('hashchange', schedule);
    window.removeEventListener('pageshow', schedule);
    navigation?.removeEventListener('navigatesuccess', schedule);
    players.forEach(player => player.destroy());
    players.clear();
    presets.destroy();
  };
}
