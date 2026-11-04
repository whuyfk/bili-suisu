export const MIN_RATE = 0.25;
export const MAX_RATE = 10;
// Integer slider stops keep 0.25 as an exception without shifting the 0.1 grid.
export const CUSTOM_RATES: readonly number[] = [MIN_RATE,
  ...Array.from({ length: MAX_RATE * 10 - 2 }, (_, index) => (index + 3) / 10)];

export function customRateIndex(rate: number): number {
  const bounded = Number.isFinite(rate) ? Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) : 1;
  return bounded < (MIN_RATE + CUSTOM_RATES[1]!) / 2 ? 0 : Math.round(bounded * 10) - 2;
}

export const EXTRA_RATES = [2.5, 3] as const;

export function fastForwardRate(rate: number): number {
  return rate < 3 ? 3 : Math.min(MAX_RATE, Math.round(rate * 1.5 * 1e6) / 1e6);
}

export type RateResult = { ok: true; rate: number } | { ok: false; message: string };

/** Validate the whole input; parseFloat would incorrectly accept "2.5abc". */
export function parseRate(raw: string): RateResult {
  const value = raw.trim();
  if (!value) return { ok: false, message: '请输入倍速。' };
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return { ok: false, message: '请输入数字，最多两位小数。' };
  }
  const rate = Number(value);
  if (!isSupportedRate(rate)) {
    return { ok: false, message: `倍速范围为 ${MIN_RATE}–${MAX_RATE}。` };
  }
  return { ok: true, rate };
}

export function isSupportedRate(rate: number): boolean {
  return Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE;
}

export function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001;
}

export function formatRate(rate: number): string {
  return Number(rate.toFixed(2)).toString();
}

export function isPlaybackPage(path: string): boolean {
  return /^\/video\/(?:BV[\w]+|av\d+)(?:\/|$)/i.test(path)
    || /^\/bangumi\/play\/(?:ep|ss)\d+(?:\/|$)/.test(path)
    || /^\/list\/(?:ml\d+|\d+\/)/.test(path);
}

/** Tracking parameters and comment anchors do not start another video. */
export function playbackKey(href: string): string {
  const url = new URL(href);
  const identity = new URLSearchParams();
  for (const key of ['aid', 'bvid', 'cid', 'ep_id', 'oid', 'p']) {
    const value = url.searchParams.get(key);
    if (value && !(key === 'p' && value === '1')) identity.set(key, value);
  }
  return `${url.pathname.replace(/\/$/, '')}?${identity}`;
}

/** One video may have several parts/sources; another BV, episode or list item is a new video. */
export function videoKey(href: string): string {
  const url = new URL(href);
  const path = url.pathname.replace(/\/$/, '');
  // The path already identifies an ordinary video or an explicit episode.
  if (/^\/video\//i.test(path) || /^\/bangumi\/play\/ep\d+$/.test(path)) return path;
  const identity = new URLSearchParams();
  for (const key of ['aid', 'bvid', 'ep_id', 'oid']) {
    const value = url.searchParams.get(key);
    if (value) identity.set(key, value);
  }
  return `${path}?${identity}`;
}
