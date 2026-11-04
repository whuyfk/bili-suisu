// Disposable profiles only. Exercises actual BPX menus and extension storage;
// reused-media events are simulated, followed by a real cross-page navigation.
import { chromium, firefox } from 'playwright';
import { firefoxSession } from './firefox-session.mjs';
import { customRateIndex } from '../src/rate.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const { version: extensionVersion } = JSON.parse(await readFile('package.json', 'utf8'));
const urls = ['https://www.bilibili.com/video/BV1GJ411x7h7/',
  'https://www.bilibili.com/bangumi/play/ep317925'];
const results = [];
for (const name of (process.env.LIVE_BROWSERS ?? 'chrome,edge,firefox').split(',')) {
  let browser, page, session, version;
  if (name === 'firefox') {
    session = await firefoxSession(firefox.executablePath(), resolve('dist/firefox'));
    version = session.capabilities.capabilities.browserVersion;
  } else {
    browser = await chromium.launch({ channel: name === 'edge' ? 'msedge' : 'chrome', headless: true,
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: resolve('dist/chromium'), enableInIncognito: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    version = browser.version();
  }
  const evaluate = source => session ? session.evaluate(source) : page.evaluate(`(() => { ${source} })()`);
  const execute = source => evaluate(`${source}; return true;`);
  const rate = () => evaluate(`return document.querySelector('.bpx-player-container video')?.playbackRate;`);
  async function until(source, description) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await evaluate(source)) return;
      await delay(250);
    }
    throw new Error(`Timed out: ${description}`);
  }
  async function navigate(url) {
    if (session) await session.command('WebDriver:Navigate', { url });
    else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await until(`return !!document.querySelector('[data-bs4-trigger]')
      && document.querySelector('.bpx-player-container video')?.readyState >= 2;`, 'live media ready');
  }
  try {
    for (const url of urls.filter(url => !process.env.LIVE_PAGE || url.includes(process.env.LIVE_PAGE))) {
      for (const action of (process.env.LIVE_ACTIONS ?? 'unpin,clear,delete').split(',')) {
        const row = { browser: name, version, extensionVersion, url, action,
          mode: 'installed extension; BPX menu actions; simulated reused-media lifecycle; real navigation' };
        try {
          await navigate(url);
          await execute(`const control=document.querySelector('.bpx-player-ctrl-playbackrate');
            if(control.dataset.bs4State==='closed')control.click();
            document.querySelector('[data-bs4-trigger]').click();
            const slider=document.querySelector('[data-bs4-editor] input');
            slider.value='${customRateIndex(4.2)}'; slider.dispatchEvent(new Event('input',{bubbles:true}));
            const save=document.querySelector('[data-bs4-save]');
            if(save.getAttribute('aria-pressed')!=='true')save.click();`);
          await until(`return document.querySelector('[data-bs4-save]')?.getAttribute('aria-pressed')==='true';`, 'shortcut saved');
          await execute(`document.querySelector('[data-bs4-editor] .bs4-confirm').click();
            document.querySelector('.bpx-player-ctrl-playbackrate').click();
            document.querySelector('[data-value="4.2"] > [data-bs4-pin]').click();`);
          await until(`return document.querySelector('[data-value="4.2"] > [data-bs4-pin]')?.getAttribute('aria-pressed')==='true';`, 'pin saved');
          assert.equal(await rate(), 4.2);
          const selector = action === 'unpin' ? '[data-value="4.2"] > [data-bs4-pin]'
            : action === 'clear' ? '[data-bs4-clear]' : '[data-value="4.2"] [data-bs4-delete]';
          await execute(`document.querySelector('${selector}').click();`);
          await until(`return !document.querySelector('[data-bs4-pin][aria-pressed="true"]');`, 'pin removed');
          await delay(1200);
          row.currentRate = await rate();
          assert.equal(row.currentRate, 4.2, 'unpin must leave the current video alone');
          await execute(`const video=document.querySelector('.bpx-player-container video');
            video.dispatchEvent(new Event('emptied')); video.dispatchEvent(new Event('loadedmetadata'));`);
          await until(`return document.querySelector('.bpx-player-container video')?.playbackRate===1;`, 'reused video released');
          await delay(1200);
          row.reusedMediaRate = await rate();
          assert.equal(row.reusedMediaRate, 1);
          await navigate(urls.find(next => next !== url));
          await delay(1200);
          row.nextPageRate = await rate();
          assert.equal(row.nextPageRate, 1, 'real next page must no longer use the pin');
          row.ok = true;
        } catch (error) {
          row.ok = false; row.error = String(error);
          row.page = await evaluate(`return {url:location.href,title:document.title,
            injected:!!document.querySelector('[data-bs4-trigger]'),
            media:[...document.querySelectorAll('video')].map(video=>({readyState:video.readyState,rate:video.playbackRate,error:video.error?.code})),
            player:document.querySelector('.bpx-player-container')?.textContent?.slice(0,800)};`).catch(() => null);
        }
        results.push(row);
        console.log(JSON.stringify(row));
        await writeFile('docs/live-unpin-results.json', `${JSON.stringify(results, null, 2)}\n`);
      }
    }
  } finally {
    if (session) await session.close();
    if (browser) await browser.close();
  }
}
if (results.some(row => !row.ok)) process.exitCode = 1;
