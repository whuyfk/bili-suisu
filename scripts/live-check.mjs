// Read-only public-page smoke checks in fresh, disposable browser profiles.
// Never uses the user's signed-in profile; shortcut storage stays in disposable profiles.
import { chromium } from 'playwright';
import { customRateIndex } from '../src/rate.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

async function chooseDraft(input, rate) {
  await input.focus();
  await input.evaluate((slider, value) => {
    slider.value = String(value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, customRateIndex(Number(rate)));
}

const output = resolve('docs/screenshots');
const { version: extensionVersion } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir(output, { recursive: true });
const requested = (process.env.LIVE_BROWSERS ?? 'chrome,edge,firefox').split(',');
const urls = [
  'https://www.bilibili.com/video/BV1GJ411x7h7/',
  'https://www.bilibili.com/bangumi/play/ep317925',
].filter(url => !process.env.LIVE_PAGE || url.includes(process.env.LIVE_PAGE));
async function browse(page) {
  await page.bringToFront();
  await page.mouse.move(10, 10);
  await page.locator('.bpx-player-ctrl-playbackrate').hover();
  await page.locator('[data-bs4-menu]').waitFor({ state: 'visible' });
}
async function edit(page) {
  if (await page.locator('[data-bs4-editor]').isVisible()) return;
  await browse(page);
  await page.locator('[data-bs4-trigger]').click();
  await page.locator('[data-bs4-editor]').waitFor({ state: 'visible' });
}
async function expectClosed(page) {
  assert.equal(await page.locator('.bpx-player-ctrl-playbackrate').getAttribute('data-bs4-state'), 'closed');
  assert.equal(await page.locator('[data-bs4-menu]').isVisible(), false);
}
const results = [];
for (const name of requested.filter(name => name !== 'firefox')) {
  const browser = await chromium.launch({
    channel: name === 'edge' ? 'msedge' : 'chrome',
    headless: process.env.HEADED !== '1',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  try {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: resolve('dist/chromium'), enableInIncognito: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    for (const url of urls) {
      const page = await context.newPage();
      const result = { browser: name, version: browser.version(), url, extensionVersion, mode: 'installed extension' };
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            break;
          } catch (error) {
            if (attempt === 2) throw error;
            await page.waitForTimeout(500);
          }
        }
        await page.locator('.bpx-player-ctrl-playbackrate').waitFor({ timeout: 30_000 });
        await page.locator('[data-bs4-custom]').waitFor({ state: 'attached' });
        await page.waitForFunction(() => {
          const video = document.querySelector('.bpx-player-container video');
          return video && video.readyState >= 2;
        }, null, { timeout: 25_000 });
        await page.mouse.move(400, 300);
        await page.locator('.bpx-player-ctrl-playbackrate').hover();
        const menu = page.locator('[data-bs4-menu]');
        await menu.waitFor({ state: 'visible', timeout: 5000 });
        result.presets = await menu.locator('[data-value]').evaluateAll(nodes => nodes.map(n => Number(n.dataset.value)));
        const checks = [];
        for (const rate of [2.5, 3, 3.5, 4, 6, 10]) {
          if (rate <= 3) {
            await browse(page);
            await menu.locator(`[data-bs4-rate="${rate}"]`).click();
          }
          else {
            assert.equal(await menu.locator(`[data-bs4-rate="${rate}"]`).count(), 0);
            await edit(page);
            await chooseDraft(menu.locator('input'), rate);
            await menu.locator('input').press('Enter');
          }
          await expectClosed(page);
          await page.waitForTimeout(1200);
          const actual = await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate);
          assert.equal(actual, rate);
          checks.push({ requested: rate, actual });
        }
        const input = menu.locator('input');
        await edit(page);
        const sliderBox = await input.boundingBox();
        await page.mouse.click(sliderBox.x + sliderBox.width * 0.6, sliderBox.y + sliderBox.height / 2);
        const mouseRate = Number(await input.getAttribute('aria-valuenow'));
        assert.ok(mouseRate > 5 && mouseRate < 7);
        assert.ok(Math.abs(mouseRate * 10 - Math.round(mouseRate * 10)) < 0.0001);
        assert.equal(await menu.locator('output').textContent(), mouseRate.toFixed(1));
        assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), 10);
        await menu.getByRole('button', { name: '应用', exact: true }).click();
        await expectClosed(page);
        assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), mouseRate);
        result.mouseSlider = { selected: mouseRate, applied: mouseRate };

        await edit(page);
        await page.mouse.move(10, 10);
        await menu.waitFor({ state: 'hidden' });
        await expectClosed(page);
        result.untouchedEditorDismissesOnLeave = true;
        await edit(page);
        await chooseDraft(input, '2.8');
        await input.press('Enter');
        await expectClosed(page);
        await page.waitForTimeout(1200);
        result.custom = await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate);
        assert.equal(result.custom, 2.8);
        const native = menu.locator('[data-value="1.5"]');
        await browse(page);
        await native.click();
        await expectClosed(page);
        await page.waitForTimeout(1200);
        result.native = await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate);
        assert.equal(result.native, 1.5);
        await edit(page);
        await chooseDraft(input, '2.8');
        await page.mouse.move(20, 20);
        await menu.waitFor({ state: 'hidden' });
        result.editedSliderDismissesOnLeave = true;
        assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), 1.5);
        await edit(page);
        await chooseDraft(input, '2.8');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.bpx-player-control-bottom')).opacity === '1');
        result.focusedToolbarOpacity = await page.locator('.bpx-player-control-bottom').evaluate(el => getComputedStyle(el).opacity);
        assert.equal(result.focusedToolbarOpacity, '1');
        await input.press('Enter');
        await expectClosed(page);
        result.dismissedAfterSelection = true;
        for (const draft of ['3.8', '8.5']) {
          await edit(page);
          await chooseDraft(input, draft);
          await menu.getByRole('button', { name: '取消', exact: true }).click();
          assert.equal(await menu.locator('[data-bs4-editor]').isVisible(), false);
          assert.equal(await menu.locator('[data-bs4-trigger]').evaluate(el => el === document.activeElement), true);
          await page.mouse.move(10, 10);
          await menu.waitFor({ state: 'hidden' });
          await expectClosed(page);
          assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), 2.8);
        }
        result.dismissedAfterCancelAndPointerLeave = true;
        result.checks = checks;
        result.media = await page.locator('.bpx-player-container video').first().evaluate(async v => {
          // This is a playback check; no media or audio is downloaded to disk.
          try { await v.play(); } catch { /* autoplay restrictions are recorded */ }
          const before = v.currentTime;
          const wall = performance.now();
          await new Promise(resolve => setTimeout(resolve, 700));
          return { rate: v.playbackRate, readyState: v.readyState, paused: v.paused,
            advanced: v.currentTime - before, elapsed: (performance.now() - wall) / 1000,
            muted: v.muted, volume: v.volume, preservesPitch: v.preservesPitch };
        });
        assert.equal(result.media.rate, 2.8);
        assert.ok(result.media.advanced > 0.5, 'live video should actually advance');
        await edit(page);
        await chooseDraft(input, 4.2);
        const favorite = page.locator('[data-bs4-save]');
        await favorite.click();
        await page.locator('[data-bs4-rate="4.2"]').waitFor({ state: 'attached' });
        await favorite.click();
        await page.locator('[data-bs4-rate="4.2"]').waitFor({ state: 'detached' });
        await favorite.click();
        await page.locator('[data-bs4-rate="4.2"]').waitFor({ state: 'attached' });
        assert.equal(await favorite.getAttribute('aria-pressed'), 'true');
        result.favoriteToggle = true;
        await page.getByRole('button', { name: '取消', exact: true }).click();
        assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), 2.8);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('[data-bs4-rate="4.2"]').waitFor({ state: 'attached' });
        await browse(page);
        await page.locator('[data-bs4-rate="4.2"] .bs4-choice').click();
        assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), 4.2);
        await browse(page);
        await page.getByRole('button', { name: '删除 4.2 倍快捷项', exact: true }).click();
        await page.locator('[data-bs4-rate="4.2"]').waitFor({ state: 'detached' });
        for (const rate of [2.8, 6]) {
          await edit(page);
          await chooseDraft(page.locator('[data-bs4-editor] input'), rate);
          await page.locator('[data-bs4-save]').click();
          await page.locator(`[data-bs4-rate="${rate}"]`).waitFor({ state: 'attached' });
          await page.getByRole('button', { name: '取消', exact: true }).click();
        }
        await page.locator('[data-bs4-clear]').click();
        await page.locator('[data-bs4-saved]').waitFor({ state: 'detached' });
        assert.equal(await page.locator('[data-bs4-rate]').count(), 2);
        assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), 4.2);
        result.savedPresets = { persistedAfterReload: true, select: true, delete: true, clear: true };
        // Hovering an unselected row pins and applies it in one click.
        await browse(page);
        await page.locator('[data-bs4-menu] > [data-value="1.5"]').hover();
        await page.locator('[data-value="1.5"] > [data-bs4-pin]').click();
        await page.waitForFunction(() => document.querySelector('[data-value="1.5"] > [data-bs4-pin]')?.getAttribute('aria-pressed') === 'true');
        assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), 1.5);
        await page.mouse.move(10, 10);
        await page.waitForTimeout(200);
        await browse(page);
        assert.equal(await page.locator('[data-bs4-clear]').isVisible(), true);
        await edit(page);
        assert.equal(await page.locator('[data-bs4-pin-current]').count(), 0);
        await page.getByRole('button', { name: '取消', exact: true }).click();
        assert.equal(await page.locator('[data-bs4-clear]').isVisible(), true);
        result.hoverPin = { appliesAndPersists: true, clearAfterReopen: true, noEditorPin: true };
        await page.locator('[data-bs4-menu] > [data-value="3"]').hover();
        await page.locator('[data-value="3"] > [data-bs4-pin]').click();
        await page.waitForFunction(() => document.querySelector('[data-value="3"] > [data-bs4-pin]')?.getAttribute('aria-pressed') === 'true');
        await page.locator('[data-bs4-menu] > [data-value="1.5"]').click();
        assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), 1.5);
        const next = await context.newPage();
        const nextUrl = url.includes('/bangumi/') ? 'https://www.bilibili.com/video/BV1GJ411x7h7/' : 'https://www.bilibili.com/bangumi/play/ep317925';
        try {
          await next.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await next.waitForFunction(() => document.querySelector('.bpx-player-container video')?.playbackRate === 3, null, { timeout: 30_000 });
          await browse(next);
          assert.equal(await next.locator('[data-bs4-pin-current]').getAttribute('aria-pressed'), 'true');
          await next.locator('[data-bs4-pin-current]').click();
          await next.waitForFunction(() => document.querySelector('[data-bs4-pin-current]')?.getAttribute('aria-pressed') === 'false');
          assert.equal(await page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate), 1.5);
          // Re-pin, then clear from another existing page.
          await browse(next);
          await next.locator('[data-bs4-menu] > [data-value="3"]').hover();
          await next.locator('[data-value="3"] > [data-bs4-pin]').click();
          await next.waitForFunction(() => document.querySelector('[data-bs4-pin-current]')?.getAttribute('aria-pressed') === 'true');
          await browse(page);
          await page.locator('[data-bs4-clear]').click();
          await next.waitForFunction(() => document.querySelector('[data-bs4-pin-current]')?.getAttribute('aria-pressed') === 'false');
          await edit(page);
          await chooseDraft(page.locator('[data-bs4-editor] input'), 4.2);
          await page.locator('[data-bs4-editor] input').press('Enter');
          await edit(page);
          await page.locator('[data-bs4-save]').click();
          await page.getByRole('button', { name: '取消', exact: true }).click();
          await page.locator('[data-bs4-pin-current]').click();
          await page.waitForFunction(() => document.querySelector('[data-bs4-pin-current]')?.getAttribute('aria-pressed') === 'true');
          await next.reload({ waitUntil: 'domcontentloaded' });
          await next.waitForFunction(() => document.querySelector('.bpx-player-container video')?.playbackRate === 4.2, null, { timeout: 30_000 });
          await browse(page);
          await page.getByRole('button', { name: '删除 4.2 倍快捷项', exact: true }).click();
          await next.locator('[data-value="4.2"]').waitFor({ state: 'detached' });
          assert.equal(await next.locator('[data-bs4-pin][aria-pressed="true"]').count(), 0);
          result.pinnedDefault = { nextUrl, restored: 3, temporaryRate: 1.5, unpin: true, clear: true, customRestored: 4.2, deleteClearsPin: true };
        } finally { await next.close(); }
        const kind = url.includes('/bangumi/') ? 'bangumi' : 'video';
        // Actual Bilibili page screenshots only; fixture screenshots are not
        // suitable store assets and are never placed in this directory.
        await browse(page);
        await page.screenshot({ path: resolve(output, `${name}-${kind}.png`) });
        result.ok = true;
      } catch (error) {
        result.ok = false;
        result.error = String(error);
        await page.screenshot({ path: resolve(output, `${name}-failure-${results.length}.png`) }).catch(() => {});
      } finally { await page.close(); }
      results.push(result);
      console.log(JSON.stringify(result));
      let previous = [];
      try { previous = JSON.parse(await readFile('docs/live-results.json', 'utf8')); } catch { /* first run */ }
      const retained = previous.filter(row => !results.some(result => result.browser === row.browser && result.url === row.url));
      await writeFile(resolve('docs/live-results.json'), `${JSON.stringify([...retained, ...results], null, 2)}\n`);
    }
  } finally { await browser.close(); }
}
if (results.some(result => !result.ok)) process.exitCode = 1;
if (requested.includes('firefox')) {
  const result = spawnSync(process.execPath, ['scripts/firefox-live.mjs'], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = 1;
}
