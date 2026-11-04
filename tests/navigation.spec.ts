import { expect, test } from '@playwright/test';
import { actualRate, loadCore, openMenu, saveShortcut, setCustomRate } from './helpers';

test.beforeEach(async ({ page }) => { await loadCore(page); });

for (const rate of [0.5, 0.75, 1.25, 1.5, 2]) {
  for (const action of ['unpin', 'clear']) {
    test(`native ${rate}x ${action} releases defaultPlaybackRate through repeated autoplay and recommendations`, async ({ page }) => {
      await openMenu(page); await page.locator(`[data-bs4-menu] > [data-value="${rate}"]`).click();
      expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.defaultPlaybackRate)).toBe(rate);
      await openMenu(page); await page.locator(`[data-value="${rate}"] > [data-bs4-pin]`).click();
      await expect(page.locator('[data-bs4-pin][aria-pressed="true"]')).toHaveCount(1);
      await page.locator(action === 'clear' ? '[data-bs4-clear]' : `[data-value="${rate}"] > [data-bs4-pin]`).click();
      await expect(page.locator('[data-bs4-pin][aria-pressed="true"]')).toHaveCount(0);
      expect(await actualRate(page)).toBe(rate);
      expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.defaultPlaybackRate)).toBe(1);
      for (let episode = 1; episode <= 3; episode++) {
        await page.evaluate(episode => {
          history.pushState({}, '', `/video/BVrecommended${episode}/?spm_id_from=333.788.recommend_more_video`);
          const v = document.querySelector('video')!;
          v.dispatchEvent(new Event('emptied'));
          v.dispatchEvent(new Event('loadstart'));
          v.playbackRate = v.defaultPlaybackRate;
          v.dispatchEvent(new Event('loadedmetadata'));
          document.body.append(document.createElement('span'));
        }, episode);
        await expect.poll(() => actualRate(page)).toBe(1);
      }
    });
  }
}

test('a slow media startup still releases a late BPX rate, but pause/resume does not force the speed', async ({ page }) => {
  await saveShortcut(page, 4.2);
  await setCustomRate(page, 4.2); await openMenu(page);
  await page.locator('[data-bs4-pin-current]').click();
  await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-bs4-pin-current]').click();
  await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => {
    const v = document.querySelector('video')!;
    v.dispatchEvent(new Event('emptied')); v.playbackRate = 1; v.dispatchEvent(new Event('loadedmetadata'));
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const v = document.querySelector('video')!;
    v.playbackRate = 4.2; v.dispatchEvent(new Event('canplay')); v.dispatchEvent(new Event('playing'));
  });
  await expect.poll(() => actualRate(page)).toBe(1);
  await page.waitForTimeout(1150);
  await page.evaluate(() => {
    const v = document.querySelector('video')!;
    v.playbackRate = 1.5; v.dispatchEvent(new Event('playing'));
  });
  await page.waitForTimeout(1100);
  expect(await actualRate(page)).toBe(1.5);
});

test('tracking-only URL changes do not restore a pin over a temporary selection', async ({ page }) => {
  await setCustomRate(page, 3); await openMenu(page); await page.locator('[data-bs4-pin-current]').click();
  await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
  await setCustomRate(page, 0.5);
  await page.evaluate(() => {
    history.pushState({}, '', '?spm_id_from=333.788&from_source=video_card#reply');
    document.body.append(document.createElement('span'));
  });
  await page.waitForTimeout(1200);
  expect(await actualRate(page)).toBe(0.5);
});

test('a new manual selection cancels delayed startup recovery after unpinning', async ({ page }) => {
  await openMenu(page); await page.locator('[data-value="0.5"]').click();
  await openMenu(page); await page.locator('[data-bs4-pin-current]').click();
  await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-bs4-pin-current]').click();
  await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => document.querySelector('video')!.dispatchEvent(new Event('emptied')));
  await setCustomRate(page, 2.5);
  await page.evaluate(() => {
    const video = document.querySelector('video')!;
    for (const type of ['loadedmetadata', 'loadeddata', 'canplay', 'playing']) video.dispatchEvent(new Event(type));
  });
  await page.waitForTimeout(1200);
  expect(await actualRate(page)).toBe(2.5);
});

test('part changes and browser back/forward are media boundaries even with a reused player', async ({ page }) => {
  await openMenu(page); await page.locator('[data-value="3"]').click();
  await openMenu(page); await page.locator('[data-bs4-pin-current]').click();
  await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
  await setCustomRate(page, 0.5);
  await page.evaluate(() => {
    history.pushState({}, '', '?p=2');
    document.body.append(document.createElement('span'));
  });
  await expect.poll(() => actualRate(page)).toBe(3);
  await setCustomRate(page, 1.5); await page.goBack();
  await expect.poll(() => actualRate(page)).toBe(3);
  await setCustomRate(page, 2.5); await page.goForward();
  await expect.poll(() => actualRate(page)).toBe(3);
});

for (const action of ['unpin', 'clear', 'delete']) {
  test(`${action} also releases a stale native default left before a custom pin`, async ({ page }) => {
    await openMenu(page); await page.locator('[data-value="0.5"]').click();
    await saveShortcut(page, 4.2); await setCustomRate(page, 4.2); await openMenu(page);
    await page.locator('[data-bs4-pin-current]').click();
    await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.defaultPlaybackRate)).toBe(0.5);
    await page.locator(action === 'unpin' ? '[data-bs4-pin-current]'
      : action === 'clear' ? '[data-bs4-clear]' : '[data-value="4.2"] [data-bs4-delete]').click();
    await expect(page.locator('[data-bs4-pin][aria-pressed="true"]')).toHaveCount(0);
    expect(await actualRate(page)).toBe(4.2);
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.defaultPlaybackRate)).toBe(1);
    await page.evaluate(() => {
      const previous = document.querySelector('video')!;
      const next = document.createElement('video'); next.defaultPlaybackRate = 0.5; next.playbackRate = 0.5;
      previous.replaceWith(next);
    });
    await expect.poll(() => actualRate(page)).toBe(1);
  });
}

test('unpinning a different row releases the current native slow speed on the next media only', async ({ page }) => {
  await openMenu(page); await page.locator('[data-value="3"]').click();
  await openMenu(page); await page.locator('[data-bs4-pin-current]').click();
  await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
  await openMenu(page); await page.locator('[data-value="0.5"]').click();
  await openMenu(page); await page.locator('[data-value="3"] > [data-bs4-pin]').click();
  await expect(page.locator('[data-bs4-pin][aria-pressed="true"]')).toHaveCount(0);
  expect(await actualRate(page)).toBe(0.5);
  await page.evaluate(() => {
    history.pushState({}, '', '?p=2'); document.body.append(document.createElement('span'));
  });
  await expect.poll(() => actualRate(page)).toBe(1);
});
