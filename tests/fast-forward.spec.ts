import { expect, test, type Page } from '@playwright/test';
import { actualRate, loadCore, openCustomEditor, openMenu, setCustomRate } from './helpers';

/** Native 300ms hold + 4x-clamped release, confirmed against the live BPX player. */
async function nativeHold(page: Page): Promise<void> {
  await page.evaluate(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let video: HTMLVideoElement | undefined;
    let original = 1;
    let active = false;
    let down = false;
    document.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' || down || !(event.target instanceof Element)
        || event.target.closest('input,textarea,select,[contenteditable]')) return;
      down = true;
      video = document.querySelector('video')!;
      original = video.playbackRate;
      timer = setTimeout(() => {
        active = true;
        const root = document.querySelector('.bpx-player-container')!;
        let hint = root.querySelector<HTMLElement>('.bpx-player-three-playrate-hint');
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'bpx-player-three-playrate-hint';
          hint.innerHTML = '<span class="bpx-player-three-playrate-hint-label">3倍播放中</span>';
          root.append(hint);
        }
        hint.style.display = 'block';
        video!.playbackRate = 3;
      }, 300);
    });
    document.addEventListener('keyup', event => {
      if (event.key !== 'ArrowRight' || !down) return;
      clearTimeout(timer);
      down = false;
      if (active && video) {
        active = false;
        const hint = document.querySelector<HTMLElement>('.bpx-player-three-playrate-hint');
        if (hint) hint.style.display = 'none';
        video.playbackRate = Math.min(4, original);
      } else if (video) {
        const nextTime = video.currentTime + 5;
        document.querySelector<HTMLElement>('.bpx-player-container')!.dataset.fixtureSeek = String(nextTime);
        video.currentTime = nextTime;
      }
    });
  });
}
async function focusPlayer(page: Page): Promise<void> {
  await page.locator('video').evaluate(video => { video.tabIndex = -1; video.focus(); });
}
async function hold(page: Page, temporary: number): Promise<void> {
  await focusPlayer(page);
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => actualRate(page)).toBe(temporary);
}
async function release(page: Page, original: number): Promise<void> {
  await page.keyboard.up('ArrowRight');
  await expect.poll(() => actualRate(page)).toBe(original);
  await page.waitForTimeout(180);
  expect(await actualRate(page)).toBe(original);
}

test.beforeEach(async ({ page }) => {
  await loadCore(page);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await nativeHold(page);
});

test('right-arrow hold follows the exact 3x threshold and restores every original speed', async ({ page }) => {
  for (const [base, temporary] of [[0.25, 3], [1.5, 3], [2.9, 3], [3, 4.5], [3.1, 4.65],
    [4.1, 6.15], [6.6, 9.9], [6.7, 10], [7, 10], [10, 10]]) {
    await setCustomRate(page, base!);
    await hold(page, temporary!);
    await expect(page.locator('[data-bs4-fastforward-label]')).toHaveText(`${temporary}倍播放中`);
    await expect(page.locator('.bpx-player-ctrl-playbackrate-result')).toHaveText(`${temporary}x`);
    await release(page, base!);
    await expect(page.locator('[data-bs4-fastforward-label]')).toHaveCount(0);
  }
});

test('short arrow presses still seek without creating a temporary speed or changing the baseline', async ({ page }) => {
  await setCustomRate(page, 7);
  await focusPlayer(page);
  const before = await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  expect(await actualRate(page)).toBe(7);
  // Chromium reports seekable=[0,0] for this routed WebM fixture; verify the
  // native seek handler receives the keyup. Live checks measure real seeking.
  await expect(page.locator('.bpx-player-container')).toHaveAttribute('data-fixture-seek', String(before + 5));
  await expect(page.locator('[data-bs4-fastforward-label]')).toHaveCount(0);
});

test('key repeats never multiply a temporary speed again and temporary values are not remembered', async ({ page }) => {
  await setCustomRate(page, 4.1);
  await hold(page, 6.15);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1150);
  expect(await actualRate(page)).toBe(6.15);
  await release(page, 4.1);
  await page.evaluate(() => { document.querySelector('video')!.replaceWith(document.createElement('video')); });
  await expect.poll(() => actualRate(page)).toBe(4.1);
});

test('a temporary hold never rewrites the pinned default or audio properties', async ({ page }) => {
  await setCustomRate(page, 3); await openMenu(page);
  await page.locator('[data-bs4-pin-current]').click();
  await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
  await setCustomRate(page, 7);
  const audio = await page.locator('video').evaluate((v: HTMLVideoElement) => [v.volume, v.muted, v.preservesPitch]);
  await hold(page, 10); await release(page, 7);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => [v.volume, v.muted, v.preservesPitch])).toEqual(audio);
  await page.evaluate(() => { document.querySelector('video')!.replaceWith(document.createElement('video')); });
  await expect.poll(() => actualRate(page)).toBe(3);
});

test('blur restores the snapshot and a late native keyup cannot clamp it back to 4x', async ({ page }) => {
  await setCustomRate(page, 7); await hold(page, 10);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => actualRate(page)).toBe(7);
  await page.waitForTimeout(220);
  await release(page, 7);
});

test('new media during a hold discards the old snapshot rather than restoring it into the new video', async ({ page }) => {
  await setCustomRate(page, 7); await hold(page, 10);
  await page.evaluate(() => { document.querySelector('video')!.replaceWith(document.createElement('video')); });
  await expect.poll(() => actualRate(page)).toBe(7);
  await page.evaluate(() => { document.querySelector('video')!.playbackRate = 1.5; });
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(220);
  // The page's normal bounded media restoration may still retain 7x. Wait it
  // out, then verify no leftover long-press handler locks the replacement.
  await page.waitForTimeout(1000);
  await page.evaluate(() => { document.querySelector('video')!.playbackRate = 2; });
  await page.waitForTimeout(250);
  expect(await actualRate(page)).toBe(2);
  await expect(page.locator('[data-bs4-fastforward-label]')).toHaveCount(0);
});

test('range and text editing retain their arrow-key behavior without arming fast-forward', async ({ page }) => {
  await setCustomRate(page, 7); await hold(page, 10);
  await openCustomEditor(page); await release(page, 7);
  await expect(page.locator('.bpx-player-three-playrate-hint')).toBeHidden();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await openCustomEditor(page);
  const input = page.locator('[data-bs4-editor] input');
  await input.focus();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  expect(await actualRate(page)).toBe(7);
  await expect(input).toHaveAttribute('aria-valuenow', '7.1');
  await expect(page.locator('[data-bs4-fastforward-label]')).toHaveCount(0);
  await page.evaluate(() => { const field = document.createElement('textarea'); document.body.append(field); field.focus(); });
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  expect(await actualRate(page)).toBe(7);
});

test('an explicit native menu choice during a hold supersedes the pre-hold snapshot', async ({ page }) => {
  await setCustomRate(page, 7); await hold(page, 10);
  await openMenu(page);
  await page.locator('[data-value="1.5"]').click();
  await expect.poll(() => actualRate(page)).toBe(1.5);
  await release(page, 1.5);
});


test('source reloads and SPA navigation during a hold never receive the old snapshot', async ({ page }) => {
  await setCustomRate(page, 3); await openMenu(page);
  await page.locator('[data-bs4-pin-current]').click();
  await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
  for (const kind of ['source', 'route']) {
    await setCustomRate(page, 7); await hold(page, 10);
    await page.evaluate(kind => {
      if (kind === 'source') {
        const video = document.querySelector('video')!;
        video.dispatchEvent(new Event('emptied'));
        video.playbackRate = 1;
        video.dispatchEvent(new Event('loadedmetadata'));
      } else {
        history.pushState({}, '', '/video/BVnext/?p=2');
        document.body.append(document.createElement('span'));
      }
    }, kind);
    await expect.poll(() => actualRate(page)).toBe(3);
    await release(page, 3);
    await expect(page.locator('[data-bs4-fastforward-label]')).toHaveCount(0);
  }
});

test('a rejected temporary rate fails once and still restores the original on release', async ({ page }) => {
  await setCustomRate(page, 7);
  await page.evaluate(() => {
    const video = document.querySelector('video')!;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')!;
    Object.defineProperty(video, 'playbackRate', {
      get() { return descriptor.get!.call(this); },
      set(rate) {
        if (rate === 10) { video.dataset.rejected = String(Number(video.dataset.rejected ?? 0) + 1); throw new Error('unsupported'); }
        descriptor.set!.call(this, rate);
      }
    });
  });
  await focusPlayer(page); await page.keyboard.down('ArrowRight');
  await expect(page.locator('video')).toHaveAttribute('data-rejected', '1');
  await expect(page.locator('[role="status"]')).toContainText('无法设置临时倍速');
  await page.waitForTimeout(300);
  await expect(page.locator('video')).toHaveAttribute('data-rejected', '1');
  await release(page, 7);
});
