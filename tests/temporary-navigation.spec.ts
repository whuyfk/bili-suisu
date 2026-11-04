import { expect, test } from '@playwright/test';
import { actualRate, loadCore, openMenu, setCustomRate } from './helpers';
import type { PresetStorage } from '../src/presets';

test.beforeEach(async ({ page }) => { await loadCore(page); });

for (const rate of [0.5, 2, 2.5, 3, 7]) {
  test(`never-pinned ${rate}x is temporary to this video, not the next recommendation or autoplay`, async ({ page }) => {
    if (rate === 7) await setCustomRate(page, rate);
    else { await openMenu(page); await page.locator(`[data-value="${rate}"]`).click(); }
    await expect(page.locator('[data-bs4-pin][aria-pressed="true"]')).toHaveCount(0);
    expect(await actualRate(page)).toBe(rate);
    // SPA navigation can reuse the whole player, including BPX's native default.
    await page.evaluate(() => {
      history.pushState({}, '', '/video/BVrecommendation/?spm_id_from=333.788');
      document.body.append(document.createElement('span'));
    });
    await expect.poll(() => actualRate(page)).toBe(1);
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.defaultPlaybackRate)).toBe(1);
    // A late native startup must not reintroduce the previous video's rate.
    await page.evaluate(rate => {
      const v = document.querySelector('video')!;
      v.dispatchEvent(new Event('emptied'));
      v.playbackRate = rate;
      v.dispatchEvent(new Event('canplay')); v.dispatchEvent(new Event('playing'));
    }, rate);
    await expect.poll(() => actualRate(page)).toBe(1);
    await setCustomRate(page, 4.2);
    await page.evaluate(() => {
      history.pushState({}, '', '/video/BVautoplay/');
      document.body.append(document.createElement('span'));
    });
    await expect.poll(() => actualRate(page)).toBe(1);
  });
}

for (const order of ['media-before-url', 'url-before-media', 'new-root', 'late-root'] as const) {
  test(`an unpinned speed resets with ${order}, including stale native callbacks`, async ({ page }) => {
    await openMenu(page);
    await page.evaluate(order => {
      // The native callback has not run yet when navigation starts.
      (document.querySelector('[data-value="0.5"]') as HTMLElement).click();
      const mediaEvents = () => {
        const v = document.querySelector('video')!;
        v.dispatchEvent(new Event('emptied'));
        v.playbackRate = 0.5;
        v.dispatchEvent(new Event('loadedmetadata'));
      };
      if (order === 'media-before-url') mediaEvents();
      history.pushState({}, '', '/video/BVanother/');
      if (order === 'url-before-media') mediaEvents();
      if (order === 'new-root' || order === 'late-root') {
        document.querySelector('.bpx-player-container')!.remove();
        const mount = () => {
          const root = (window as unknown as { makePlayer(): HTMLElement }).makePlayer();
          const v = root.querySelector('video')!;
          v.defaultPlaybackRate = 0.5; v.playbackRate = 0.5;
          document.querySelector('#mount')!.append(root);
        };
        if (order === 'late-root') setTimeout(mount, 50); else mount();
      }
      document.body.append(document.createElement('span'));
    }, order);
    await expect.poll(() => actualRate(page)).toBe(1);
    await page.waitForTimeout(1150);
    expect(await actualRate(page)).toBe(1);
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.defaultPlaybackRate)).toBe(1);
  });
}

test('same-video parts, tracking, seeking and reconstruction retain the temporary selection', async ({ page }) => {
  await setCustomRate(page, 2.5);
  for (const suffix of ['?p=2', '?p=3&cid=123', '?p=3&cid=123&spm_id_from=333#reply']) {
    await page.evaluate(suffix => {
      history.pushState({}, '', suffix);
      document.body.append(document.createElement('span'));
    }, suffix);
    await page.waitForTimeout(150);
    expect(await actualRate(page)).toBe(2.5);
  }
  await page.evaluate(() => {
    const v = document.querySelector('video')!;
    v.pause(); v.currentTime = 2;
    v.dispatchEvent(new Event('emptied')); v.playbackRate = 1;
    v.dispatchEvent(new Event('playing'));
  });
  await expect.poll(() => actualRate(page)).toBe(2.5);
  await page.evaluate(() => {
    const root = (window as unknown as { makePlayer(): HTMLElement }).makePlayer();
    document.querySelector('.bpx-player-container')!.replaceWith(root);
  });
  await expect.poll(() => actualRate(page)).toBe(2.5);
});

test('back and forward do not recover an unpinned speed from the previous video', async ({ page }) => {
  await setCustomRate(page, 7);
  await page.evaluate(() => {
    history.pushState({}, '', '/video/BVnext/');
    document.body.append(document.createElement('span'));
  });
  await expect.poll(() => actualRate(page)).toBe(1);
  await setCustomRate(page, 0.5);
  await page.goBack(); await expect.poll(() => actualRate(page)).toBe(1);
  await setCustomRate(page, 3);
  await page.goForward(); await expect.poll(() => actualRate(page)).toBe(1);
});

test('playlist selections and bangumi episode changes reset a temporary speed', async ({ page }) => {
  for (const path of ['/list/ml123?oid=111', '/list/ml123?oid=222',
    '/bangumi/play/ep100', '/bangumi/play/ep101']) {
    await setCustomRate(page, 2.5);
    await page.evaluate(path => {
      history.pushState({}, '', path);
      document.body.append(document.createElement('span'));
    }, path);
    await expect.poll(() => actualRate(page)).toBe(1);
  }
});

test('a manual choice made immediately on the new route survives reconciliation', async ({ page }) => {
  await setCustomRate(page, 7); await openMenu(page);
  await page.evaluate(() => {
    history.pushState({}, '', '/video/BVnewChoice/');
    (document.querySelector('[data-value="1.5"]') as HTMLElement).click();
    document.body.append(document.createElement('span'));
  });
  await page.waitForTimeout(1200);
  expect(await actualRate(page)).toBe(1.5);
});

test('a late saved-pin read still applies after a video boundary with no new manual choice', async ({ page }) => {
  await page.reload();
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      browser: { storage: PresetStorage }; finishPinRead: (data: Record<string, unknown>) => void;
    };
    scope.browser.storage.local.get = () => new Promise(resolve => { scope.finishPinRead = resolve; });
  });
  await page.addStyleTag({ path: 'dist/chromium/content.css' });
  await page.addScriptTag({ path: 'dist/chromium/content.js' });
  await page.evaluate(() => {
    history.pushState({}, '', '/video/BVbeforeStorageReady/');
    document.body.append(document.createElement('span'));
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { finishPinRead(data: Record<string, unknown>): void })
      .finishPinRead({ 'biliSuisu.pinnedRate': 3 });
  });
  await expect.poll(() => actualRate(page)).toBe(3);
});

test('a fresh document without a pin leaves the site initial speed alone', async ({ page }) => {
  await page.reload();
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.defaultPlaybackRate = 1.5; v.playbackRate = 1.5;
  });
  await page.addStyleTag({ path: 'dist/chromium/content.css' });
  await page.addScriptTag({ path: 'dist/chromium/content.js' });
  await page.waitForTimeout(1150);
  expect(await actualRate(page)).toBe(1.5);
});
