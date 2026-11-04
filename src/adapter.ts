/** Confirmed against both the video and bangumi BPX players, 2026-10-20. */
export const PLAYER = '.bpx-player-container';
export const CONTROL = '.bpx-player-ctrl-playbackrate';
export const MENU = '.bpx-player-ctrl-playbackrate-menu';
export const ITEM_CLASS = 'bpx-player-ctrl-playbackrate-menu-item';
export const ITEM = `.${ITEM_CLASS}`;
export const ACTIVE_CLASS = 'bpx-state-active';
export const RESULT = '.bpx-player-ctrl-playbackrate-result';

export function getMedia(root: HTMLElement): HTMLVideoElement | null {
  // Stay inside the main player: recommendation/preview videos are unrelated.
  return root.querySelector<HTMLVideoElement>('.bpx-player-video-wrap video')
    ?? root.querySelector<HTMLVideoElement>('.bpx-player-video-area video')
    ?? root.querySelector<HTMLVideoElement>('video');
}

export function getItemRate(item: Element): number | null {
  const raw = item.getAttribute('data-value');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function rateItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.children].filter((node): node is HTMLElement =>
    node instanceof HTMLElement && node.matches(ITEM) && getItemRate(node) !== null);
}
