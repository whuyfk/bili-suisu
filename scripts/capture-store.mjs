import { chromium } from 'playwright';
import { customRateIndex } from '../src/rate.ts';
import { resolve } from 'node:path';

async function chooseDraft(input, rate) {
  await input.focus();
  await input.evaluate((slider, value) => {
    slider.value = String(value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, customRateIndex(Number(rate)));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
try {
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send('Extensions.loadUnpacked', { path: resolve('dist/chromium'), enableInIncognito: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto('https://www.bilibili.com/bangumi/play/ep317925', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-bs4-custom]').waitFor({ state: 'attached' });
  await page.mouse.move(400, 300);
  await page.getByRole('button', { name: '网页全屏', exact: true }).click();
  // Switch off danmaku using the actual site control, if available. No image
  // retouching or hidden screenshot-specific CSS is used.
  const danmaku = page.locator('.bpx-player-dm-switch input');
  if (await danmaku.count() && await danmaku.isChecked()) await danmaku.uncheck({ force: true });
  await page.locator('.bpx-player-ctrl-playbackrate').hover();
  await page.locator('[data-bs4-menu]').screenshot({ path: 'docs/screenshots/menu-footer-single.png' });
  await page.locator('[data-bs4-trigger]').click();
  const input = page.locator('[data-bs4-custom] input');
  await chooseDraft(input, '2.8');
  await page.locator('[data-bs4-menu]').screenshot({ path: 'docs/screenshots/custom-editor.png' });
  await input.press('Enter');
  if (await page.locator('[data-bs4-menu]').isVisible()) throw new Error('Menu did not dismiss after Enter');
  await page.waitForTimeout(1500);
  await page.mouse.move(80, 300);
  await page.locator('.bpx-player-ctrl-playbackrate').hover();
  await page.locator('[data-bs4-trigger]').click();
  await page.locator('[data-bs4-save]').click();
  await page.locator('[data-bs4-saved]').waitFor({ state: 'attached' });
  await page.locator('[data-bs4-menu]').screenshot({ path: 'docs/screenshots/custom-editor-saved.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('[data-bs4-menu]').screenshot({ path: 'docs/screenshots/menu-pin-off.png' });
  await page.locator('[data-bs4-menu]').screenshot({ path: 'docs/screenshots/menu-footer-pair.png' });
  await page.locator('[data-bs4-pin-current]').click();
  await page.waitForFunction(() => document.querySelector('[data-bs4-pin-current]')?.getAttribute('aria-pressed') === 'true');
  await page.locator('[data-bs4-trigger]').click();
  await page.locator('[data-bs4-menu]').screenshot({ path: 'docs/screenshots/custom-editor-pinned.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/store-player-1280x800.png', scale: 'css' });
  await page.locator('[data-bs4-menu]').screenshot({ path: 'docs/screenshots/menu-compact.png' });
  console.log('Captured actual Bilibili web fullscreen player at docs/screenshots/store-player-1280x800.png');
} finally { await browser.close(); }
