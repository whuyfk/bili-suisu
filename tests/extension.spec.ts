import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { actualRate, fixtureUrl, openMenu, openCustomEditor, serveFixture, saveShortcut, chooseDraft, setCustomRate } from './helpers';

for (const channel of ['chrome', 'msedge'] as const) {
  test(`installed MV3 package works in ${channel} via browser extension loader`, async () => {
    const browser = await chromium.launch({ channel, headless: true,
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
    try {
      const cdp = await browser.newBrowserCDPSession();
      const loaded = await cdp.send('Extensions.loadUnpacked', { path: resolve('dist/chromium'), enableInIncognito: true });
      expect(loaded.id).toBeTruthy();
      const context = await browser.newContext();
      await serveFixture(context);
      const page = await context.newPage();
      await page.goto(fixtureUrl);
      await expect(page.locator('[data-bs4-rate]')).toHaveCount(2);
      await openMenu(page);
      await openCustomEditor(page);
      await page.locator('[data-bs4-custom] input').press('End');
      await page.locator('[data-bs4-custom] input').press('Enter');
      await expect.poll(() => actualRate(page)).toBe(10);
      await expect(page.locator('.bpx-player-ctrl-playbackrate-result')).toHaveText('10x');
      await page.reload();
      await expect(page.locator('[data-bs4-rate]')).toHaveCount(2);
      expect(await actualRate(page)).toBe(1);
      // Real extension storage, no fixture mock: reload, new tab and live synchronization.
      await saveShortcut(page, 2.8);
      await expect(page.locator('[data-bs4-saved]')).toHaveCount(1);
      const other = await context.newPage();
      await other.goto(fixtureUrl);
      await expect(other.locator('[data-bs4-rate="2.8"]')).toHaveCount(1);
      expect(await actualRate(other)).toBe(1);
      await saveShortcut(other, 4.2);
      await expect(page.locator('[data-bs4-saved]')).toHaveCount(2);
      await page.reload();
      await expect(page.locator('[data-bs4-saved]')).toHaveCount(2);
      expect(await actualRate(page)).toBe(1);
      await openCustomEditor(page);
      await chooseDraft(page, 4.2);
      await expect(page.locator('[data-bs4-save]')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('[data-bs4-save]').click();
      await expect(other.locator('[data-bs4-rate="4.2"]')).toHaveCount(0);
      await expect(page.locator('[data-bs4-save]')).toHaveAttribute('aria-pressed', 'false');
      await page.locator('[data-bs4-save]').click();
      await expect(other.locator('[data-bs4-rate="4.2"]')).toHaveCount(1);
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('button', { name: '删除 2.8 倍快捷项', exact: true }).click();
      await expect(other.locator('[data-bs4-rate="2.8"]')).toHaveCount(0);
      await other.locator('[data-bs4-clear]').click();
      await expect(page.locator('[data-bs4-saved]')).toHaveCount(0);
      await expect(other.locator('[data-bs4-saved]')).toHaveCount(0);
      await page.reload();
      await expect(page.locator('[data-bs4-rate]')).toHaveCount(2);
      expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
      // Pin is persistent, but a temporary selection stays local to its current video.
      await openMenu(page);
      await page.locator('[data-value="3"]').click();
      await openMenu(page);
      await page.locator('[data-bs4-pin-current]').click();
      await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
      expect(await actualRate(other)).toBe(1);
      await page.reload();
      await expect.poll(() => actualRate(page)).toBe(3);
      await openMenu(page);
      await page.locator('[data-value="1.5"]').click();
      expect(await actualRate(page)).toBe(1.5);
      const next = await context.newPage();
      await next.goto('https://www.bilibili.com/bangumi/play/ep317925');
      await expect.poll(() => actualRate(next)).toBe(3);
      await openMenu(next);
      await next.locator('[data-bs4-pin-current]').click();
      await expect(next.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'false');
      expect(await actualRate(page)).toBe(1.5);
      // Real storage.onChanged must also release page-memory defaults in other tabs.
      for (const target of [page, next]) {
        await target.evaluate(() => {
          history.pushState({}, '', '/video/BVreleasedPin/');
          document.body.append(document.createElement('span'));
        });
        await expect.poll(() => actualRate(target)).toBe(1);
      }
      await other.reload();
      await expect(other.locator('[data-bs4-rate]')).toHaveCount(2);
      expect(await actualRate(other)).toBe(1);
      // Deleting a pinned saved custom rate clears the persistent default too.
      await saveShortcut(page, 4.2);
      await page.locator('[data-value="4.2"] .bs4-choice').click();
      await openMenu(page);
      await page.locator('[data-bs4-pin-current]').click();
      await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
      await other.reload();
      await expect.poll(() => actualRate(other)).toBe(4.2);
      await page.getByRole('button', { name: '删除 4.2 倍快捷项', exact: true }).click();
      await expect(page.locator('[data-value="4.2"]')).toHaveCount(0);
      await other.evaluate(() => {
        const video = document.querySelector('video')!;
        video.dispatchEvent(new Event('emptied'));
        video.dispatchEvent(new Event('loadedmetadata'));
      });
      await expect.poll(() => actualRate(other)).toBe(1);
      await other.reload();
      await expect(other.locator('[data-bs4-rate]')).toHaveCount(2);
      expect(await actualRate(other)).toBe(1);
      // Clear also unpins a default that has no custom shortcut dependency.
      await setCustomRate(page, 3);
      await openMenu(page);
      await page.locator('[data-bs4-pin-current]').click();
      await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: '清空', exact: true }).click();
      await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'false');
      await next.reload();
      await expect(next.locator('[data-bs4-rate]')).toHaveCount(2);
      expect(await actualRate(next)).toBe(1);
      // Native 0.5x also changes defaultPlaybackRate; release it across tabs.
      await openMenu(page); await page.locator('[data-value="0.5"]').click();
      await openMenu(page); await page.locator('[data-bs4-pin-current]').click();
      await expect(page.locator('[data-bs4-pin-current]')).toHaveAttribute('aria-pressed', 'true');
      await next.reload(); await expect.poll(() => actualRate(next)).toBe(0.5);
      await openMenu(next); await next.locator('[data-value="0.75"]').click();
      expect(await next.locator('video').evaluate((v: HTMLVideoElement) => v.defaultPlaybackRate)).toBe(0.75);
      await page.locator('[data-bs4-clear]').click();
      await expect(next.locator('[data-bs4-pin][aria-pressed="true"]')).toHaveCount(0);
      expect(await actualRate(next)).toBe(0.75);
      expect(await next.locator('video').evaluate((v: HTMLVideoElement) => v.defaultPlaybackRate)).toBe(1);
      await next.evaluate(() => {
        const v = document.querySelector('video')!;
        v.dispatchEvent(new Event('emptied')); v.playbackRate = v.defaultPlaybackRate;
        v.dispatchEvent(new Event('canplay')); v.dispatchEvent(new Event('playing'));
      });
      await expect.poll(() => actualRate(next)).toBe(1);
      await page.reload(); await expect.poll(() => actualRate(page)).toBe(1);
      const fresh = await context.newPage(); await fresh.goto(fixtureUrl);
      await expect(fresh.locator('[data-bs4-trigger]')).toHaveCount(1);
      expect(await actualRate(fresh)).toBe(1); await fresh.close();
      await next.close();
      await other.close();
      await page.goto('https://www.bilibili.com/');
      await expect(page.locator('[data-bs4-custom]')).toHaveCount(0);
    } finally { await browser.close(); }
  });
}
