// Installed extensions, native trusted keyboard input, disposable browser profiles.
import { chromium, firefox } from 'playwright';
import { firefoxSession } from './firefox-session.mjs';
import { customRateIndex, fastForwardRate } from '../src/rate.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const { version: extensionVersion } = JSON.parse(await readFile('package.json', 'utf8'));
const requested = (process.env.LIVE_BROWSERS ?? 'chrome,edge,firefox').split(',');
const urls = ['https://www.bilibili.com/video/BV1GJ411x7h7/',
  'https://www.bilibili.com/bangumi/play/ep317925'].filter(url => !process.env.LIVE_PAGE || url.includes(process.env.LIVE_PAGE));
const rates = [1.5, 3, 4.1, 7, 10];
const results = [];

function selectSource(rate) {
  return `const c=document.querySelector('.bpx-player-ctrl-playbackrate');
    if(c.dataset.bs4State==='closed')c.click();
    document.querySelector('[data-bs4-trigger]').click();
    const input=document.querySelector('[data-bs4-editor] input');
    input.value='${customRateIndex(rate)}';input.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-bs4-editor] .bs4-confirm').click();
    const root=document.querySelector('.bpx-player-container');root.tabIndex=-1;root.focus();`;
}

async function run(name) {
  let browser, page, session;
  const version = name === 'firefox' ? await (async () => {
    session = await firefoxSession(firefox.executablePath(), resolve('dist/firefox'));
    return session.capabilities.capabilities.browserVersion;
  })() : await (async () => {
    browser = await chromium.launch({ channel: name === 'edge' ? 'msedge' : 'chrome', headless: true,
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: resolve('dist/chromium'), enableInIncognito: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    return browser.version();
  })();
  const readRate = () => session ? session.evaluate(`return document.querySelector('.bpx-player-container video')?.playbackRate;`)
    : page.locator('.bpx-player-container video').first().evaluate(v => v.playbackRate);
  const readLabel = () => session ? session.evaluate(`return document.querySelector('[data-bs4-fastforward-label]')?.textContent;`)
    : page.evaluate(() => document.querySelector('[data-bs4-fastforward-label]')?.textContent);
  const execute = source => session ? session.evaluate(`${source};return true;`) : page.evaluate(source);
  async function key(type) {
    if (session) await session.command('WebDriver:PerformActions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type, value: '\uE014' }] }] });
    else await page.keyboard[type === 'keyDown' ? 'down' : 'up']('ArrowRight');
  }
  async function waitRate(expected) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await readRate() === expected) return;
      await delay(100);
    }
    throw new Error(`Expected ${expected}x, received ${await readRate()}x`);
  }
  try {
    for (const url of urls) {
      const row = { browser: name, version, extensionVersion, url, mode: 'installed extension + native keyboard', checks: [] };
      try {
        if (session) await session.command('WebDriver:Navigate', { url });
        else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        let ready = false;
        for (let attempt = 0; attempt < 120; attempt++) {
          ready = session ? await session.evaluate(`return !!document.querySelector('[data-bs4-trigger]') && document.querySelector('.bpx-player-container video')?.readyState >= 2;`)
            : await page.evaluate(() => !!document.querySelector('[data-bs4-trigger]') && document.querySelector('.bpx-player-container video')?.readyState >= 2);
          if (ready) break;
          await delay(250);
        }
        assert.equal(ready, true, 'real video and automatically injected extension must be ready');
        for (const original of rates) {
          await execute(selectSource(original));
          await waitRate(original);
          await key('keyDown');
          const temporary = fastForwardRate(original);
          await waitRate(temporary);
          let label;
          for (let attempt = 0; attempt < 60; attempt++) {
            label = await readLabel();
            if (label === `${temporary}倍播放中`) break;
            await delay(100);
          }
          assert.equal(label, `${temporary}倍播放中`);
          await key('keyUp');
          await waitRate(original);
          await delay(200);
          assert.equal(await readRate(), original);
          row.checks.push({ original, temporary, restored: original, label });
        }
        // A short press is still the website's +5s seek, with no speed override.
        await execute(selectSource(1.5));
        await execute(`const video=document.querySelector('.bpx-player-container video'); video.pause();`);
        const time = session ? await session.evaluate(`return document.querySelector('.bpx-player-container video').currentTime;`)
          : await page.locator('.bpx-player-container video').first().evaluate(v => v.currentTime);
        await key('keyDown'); await key('keyUp');
        await delay(200);
        const afterTime = session ? await session.evaluate(`return document.querySelector('.bpx-player-container video').currentTime;`)
          : await page.locator('.bpx-player-container video').first().evaluate(v => v.currentTime);
        assert.ok(afterTime - time >= 4.8 && afterTime - time < 8, `Short press seek delta: ${afterTime - time}`);
        assert.equal(await readRate(), 1.5);
        row.shortPress = { seekDelta: afterTime - time, rate: 1.5 };
        row.ok = true;
      } catch (error) { row.ok = false; row.error = String(error); }
      results.push(row);
      console.log(JSON.stringify(row));
      await writeFile('docs/live-fast-forward-results.json', `${JSON.stringify(results, null, 2)}\n`);
    }
  } finally {
    if (session) await session.close();
    if (browser) await browser.close();
  }
}
for (const name of requested) await run(name);
if (results.some(row => !row.ok)) process.exitCode = 1;
