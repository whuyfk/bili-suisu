// Installed extensions in disposable headless profiles. BPX clicks, webpage
// fullscreen and viewport mouse movement are native browser actions. OS window
// blur/legacy focus restoration are simulated explicitly, never claimed as a
// complete macOS desktop focus test.
import { chromium, firefox } from 'playwright';
import { firefoxSession } from './firefox-session.mjs';
import { customRateIndex } from '../src/rate.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const { version: extensionVersion } = JSON.parse(await readFile('package.json', 'utf8'));
const results = [];
const resultsFile = process.env.LIVE_RESULTS ?? 'docs/live-menu-activation-results.json';
const control = '.bpx-player-ctrl-playbackrate';
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
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); version = browser.version();
  }
  const evaluate = code => session ? session.evaluate(code) : page.evaluate(`(() => { ${code} })()`);
  const execute = code => evaluate(`${code}; return true;`);
  async function until(code, description, attempts = 120) {
    for (let i = 0; i < attempts; i++) {
      if (await evaluate(code)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${description}`);
  }
  async function move(x, y) {
    if (!session) { await page.mouse.move(Math.round(x), Math.round(y)); return; }
    await session.command('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'mouse',
      parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', origin: 'viewport', duration: 0,
        x: Math.round(x), y: Math.round(y) }] }] });
  }
  async function click(selector) {
    if (!session) { await page.locator(selector).click(); return; }
    // BPX's sticky footer can cover the last native presets. Center-scroll them
    // as a user would, and verify the actual hit target before a native click.
    const point = await evaluate(`const e=document.querySelector(${JSON.stringify(selector)});
      e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();
      const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
      return {x,y,hittable:e.contains(document.elementFromPoint(x,y))};`);
    assert.equal(point.hittable, true, `Visible click target: ${selector}`);
    await session.command('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'mouse',
      parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', origin: 'viewport', duration: 0, x: point.x, y: point.y },
        { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
      ] }] });
  }
  async function key(key) {
    if (!session) { await page.keyboard.press(key); return; }
    const value = ({ Enter: '\uE007', Escape: '\uE00C', Space: ' ' })[key];
    await session.command('WebDriver:PerformActions', { actions: [{ type: 'key', id: 'keyboard',
      actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }] });
  }
  const state = () => evaluate(`return document.querySelector('${control}')?.dataset.bs4State;`);
  const rate = () => evaluate(`return document.querySelector('.bpx-player-container video')?.playbackRate;`);
  async function hover() {
    await move(10, 10);
    const rect = await evaluate(`const r=document.querySelector('${control}').getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};`);
    await move(rect.x, rect.y);
    await until(`return document.querySelector('${control}').dataset.bs4State==='browse';`, 'deliberate visible hover');
  }
  try {
    for (const url of ['https://www.bilibili.com/video/BV1GJ411x7h7/', 'https://www.bilibili.com/bangumi/play/ep317925']
      .filter(url => !process.env.LIVE_PAGE || url.includes(process.env.LIVE_PAGE))) {
      const row = { browser: name, version, extensionVersion, url,
        mode: 'installed headless; native BPX webpage-fullscreen, mouse, clicks and keys; simulated OS blur/focus restoration', checks: [] };
      try {
        if (session) await session.command('WebDriver:Navigate', { url });
        else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await until(`return !!document.querySelector('[data-bs4-trigger]')
          && document.querySelector('.bpx-player-container video')?.readyState>=2;`, 'ready BPX', 450);
        await move(300, 250); await delay(4000);
        assert.equal(await state(), 'closed');
        // Also verify a hover that initially needs BPX to reveal its toolbar.
        await hover(); await click('[data-bs4-menu] > [data-value="1"]');
        for (const selected of [0.5, 3]) {
          await hover(); await click(`[data-bs4-menu] > [data-value="${selected}"]`);
          assert.equal(await state(), 'closed'); assert.equal(await rate(), selected);
          await click('.bpx-player-ctrl-web');
          assert.equal(await evaluate(`return document.querySelector('.bpx-player-ctrl-web').classList.contains('bpx-state-entered');`), true);
          if (!session) await move(-20, 250);
          else await execute(`window.dispatchEvent(new PointerEvent('pointerout',{relatedTarget:null,pointerType:'mouse'}));`);
          await execute(`window.dispatchEvent(new Event('blur'));
            const button=document.querySelector('${control}');button.blur();button.focus();`);
          await move(300, 250); await delay(250);
          assert.equal(await state(), 'closed', 'returning focus over the picture must not open');
          assert.equal(await rate(), selected);
          await execute(`const button=document.querySelector('${control}');const r=button.getBoundingClientRect();
            button.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse',clientX:r.x+r.width/2,clientY:r.y+r.height/2}));`);
          await delay(150); assert.equal(await state(), 'closed', 'pointerenter alone is not activation');
          await hover(); assert.equal(await state(), 'browse');
          await move(300, 250); await delay(180); assert.equal(await state(), 'closed');
          await execute(`document.querySelector('${control}').focus();`);
          assert.equal(await state(), 'closed');
          for (const code of ['Enter', 'Space']) {
            await key(code); assert.equal(await state(), 'browse');
            await key('Escape'); assert.equal(await state(), 'closed');
          }
          await hover(); await click('[data-bs4-trigger]');
          await execute(`const slider=document.querySelector('[data-bs4-editor] input');
            slider.value='${customRateIndex(4.2)}';slider.dispatchEvent(new Event('input',{bubbles:true}));
            window.dispatchEvent(new Event('blur'));`);
          assert.equal(await state(), 'closed'); assert.equal(await rate(), selected);
          await hover(); await click('[data-bs4-trigger]');
          const draft = await evaluate(`return Number(document.querySelector('[data-bs4-editor] input').getAttribute('aria-valuenow'));`);
          assert.equal(draft, selected);
          await key('Escape');
          await click('.bpx-player-ctrl-web');
          await move(300, 250); await delay(180); assert.equal(await state(), 'closed');
          row.checks.push({ selected, webFullscreen: true, returnOverPictureClosed: true,
            restoredFocusClosed: true, enterOnlyClosed: true, deliberateHoverOpens: true,
            enterAndSpaceOpen: true, blurDiscardsDraft: true, rateUnchanged: await rate() });
        }
        row.ok = true;
      } catch (error) {
        row.ok = false; row.error = String(error);
        row.page = await evaluate(`return {url:location.href,state:document.querySelector('${control}')?.dataset.bs4State,
          active:document.activeElement?.className,rate:document.querySelector('video')?.playbackRate,
          ready:document.querySelector('video')?.readyState,error:document.querySelector('video')?.error?.code};`).catch(() => null);
      }
      results.push(row); console.log(JSON.stringify(row));
      await writeFile(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
    }
  } finally {
    if (session) await session.close();
    if (browser) await browser.close();
  }
}
if (results.some(row => !row.ok)) process.exitCode = 1;
