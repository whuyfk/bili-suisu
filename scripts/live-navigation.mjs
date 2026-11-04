// Disposable profiles, installed extension. Real recommendation navigation and
// natural ended -> autoplay, without synthesizing media lifecycle events.
import { chromium, firefox } from 'playwright';
import { firefoxSession } from './firefox-session.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const { version: extensionVersion } = JSON.parse(await readFile('package.json', 'utf8'));
const source = process.env.LIVE_SOURCE ?? 'https://www.bilibili.com/video/BV1GJ411x7h7/';
const results = [];
const resultsFile = process.env.LIVE_RESULTS ?? `docs/live-navigation-${extensionVersion}-results.json`;
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
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    version = browser.version();
  }
  const evaluate = code => session ? session.evaluate(code) : page.evaluate(`(() => { ${code} })()`);
  const execute = code => evaluate(`${code};return true;`);
  const snapshot = () => evaluate(`const v=document.querySelector('.bpx-player-container video');
    return {url:location.href,title:document.title,source:v?.currentSrc,rate:v?.playbackRate,defaultRate:v?.defaultPlaybackRate,
      ready:v?.readyState,duration:v?.duration,paused:v?.paused,document:document.documentElement.dataset.bs4AuditDocument??null};`);
  async function until(code, description, attempts = 120) {
    for (let i = 0; i < attempts; i++) {
      if (await evaluate(code).catch(() => false)) return;
      await delay(250);
    }
    throw new Error(`Timed out: ${description}`);
  }
  async function ready() {
    await until(`return !!document.querySelector('[data-bs4-trigger]')
      && document.querySelector('.bpx-player-container video')?.readyState>=2;`, 'ready media');
    await delay(1400);
  }
  async function navigate(url) {
    if (session) await session.command('WebDriver:Navigate', { url });
    else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await ready();
  }
  async function pointerClick(selector) {
    if (!session) { await page.locator(selector).first().click(); return; }
    const found = await session.command('WebDriver:FindElement', { using: 'css selector', value: selector });
    const id = found.value['element-6066-11e4-a52e-4f735466cecf'];
    await session.command('WebDriver:ElementClick', { id });
  }
  async function release(action) {
    const temporaryRate = action.startsWith('temporary-') ? Number(action.slice('temporary-'.length)) : null;
    if (temporaryRate !== null && temporaryRate !== 0.5) {
      await execute(`document.querySelector('.bpx-player-ctrl-playbackrate').click();`);
      if (temporaryRate === 2.5) await execute(`document.querySelector('[data-value="2.5"]').click();`);
      else await execute(`document.querySelector('[data-bs4-trigger]').click();
        const input=document.querySelector('[data-bs4-custom] input');input.value='${Math.round(temporaryRate * 10) - 2}';
        input.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('[data-bs4-editor] .bs4-confirm').click();`);
      await until(`return document.querySelector('.bpx-player-container video')?.playbackRate===${temporaryRate};`, 'temporary choice');
      assert.equal(await evaluate(`return !!document.querySelector('[data-bs4-pin][aria-pressed="true"]');`), false);
      return snapshot();
    }
    // Native BPX item executes its own handlers, including defaultPlaybackRate.
    await execute(`document.querySelector('.bpx-player-ctrl-playbackrate').click();
      document.querySelector('[data-bs4-menu] > [data-value="0.5"]').click();`);
    await until(`return document.querySelector('.bpx-player-container video')?.defaultPlaybackRate===0.5;`, 'BPX native 0.5');
    if (temporaryRate !== null) {
      const current = await snapshot();
      assert.equal(current.rate, temporaryRate);
      assert.equal(await evaluate(`return !!document.querySelector('[data-bs4-pin][aria-pressed="true"]');`), false);
      return current;
    }
    await execute(`document.querySelector('.bpx-player-ctrl-playbackrate').click();
      document.querySelector('[data-value="0.5"] > [data-bs4-pin]').click();`);
    await until(`return document.querySelector('[data-value="0.5"] > [data-bs4-pin]')?.getAttribute('aria-pressed')==='true';`, 'pin on');
    await execute(`document.querySelector('${action === 'clear' ? '[data-bs4-clear]' : '[data-value="0.5"] > [data-bs4-pin]'}').click();`);
    await until(`return !document.querySelector('[data-bs4-pin][aria-pressed="true"]');`, 'pin removed');
    await delay(1200);
    const current = await snapshot();
    assert.equal(current.rate, 0.5, 'current video is unchanged');
    assert.equal(current.defaultRate, 1, 'native default released');
    return current;
  }
  async function nextIsNormal(previous, expected = 1) {
    if (previous) await until(`const v=document.querySelector('.bpx-player-container video');
      return !!v?.currentSrc && v.currentSrc!==${JSON.stringify(previous.source)} && v.readyState>=2;`, 'new media source loaded', 180);
    await ready();
    const next = await snapshot();
    assert.doesNotMatch(next.title, /视频已失效|视频不见了/, 'destination must be a playable video');
    assert.equal(next.rate, expected, 'new video resets; parts retain an unpinned temporary choice');
    return next;
  }
  try {
    for (const action of (process.env.LIVE_ACTIONS ?? 'temporary-0.5,temporary-2.5,temporary-7,unpin,clear').split(',').filter(Boolean)) {
      const row = { browser: name, version, extensionVersion, action };
      try {
        await navigate(source); row.current = await release(action);
        await execute(`document.documentElement.dataset.bs4AuditDocument='recommendation';
          const a=[...document.querySelectorAll('.video-page-card-small a[href*="/video/"]')]
            .find(a=>a.textContent.trim()&&!a.textContent.includes('失效')&&new URL(a.href).pathname!==location.pathname);
          if(!a)throw new Error('No playable recommendation');a.dataset.bs4AuditNext='';`);
        const oldUrl = row.current.url;
        await pointerClick('[data-bs4-audit-next]');
        await until(`return location.href!==${JSON.stringify(oldUrl)};`, 'recommendation URL changed');
        row.recommendation = await nextIsNormal(row.current);
        assert.equal(row.recommendation.defaultRate, 1, 'recommendation native default released');
        if (session) await session.command('WebDriver:Refresh'); else await page.reload({ waitUntil: 'domcontentloaded' });
        row.refresh = await nextIsNormal();
        await navigate('https://www.bilibili.com/bangumi/play/ep317925');
        row.bangumi = await nextIsNormal();

        await navigate(source); const autoplaySource = await release(action);
        await execute(`document.documentElement.dataset.bs4AuditDocument='autoplay';
          document.querySelector('.bpx-player-ctrl-playbackrate').click();`);
        if (await evaluate(`return !document.querySelector('.continuous-btn .switch-btn')?.classList.contains('on');`)) {
          await pointerClick('.continuous-btn');
        }
        await execute(`const v=document.querySelector('.bpx-player-container video');
          v.muted=true;document.documentElement.dataset.bs4NaturalEnded='false';
          v.addEventListener('ended',()=>document.documentElement.dataset.bs4NaturalEnded='true',{once:true});
          v.play().catch(()=>{});v.currentTime=v.duration-0.2;`);
        await until(`return location.pathname!==${JSON.stringify(new URL(source).pathname)};`, 'natural autoplay navigation', 240);
        row.autoplay = await nextIsNormal(autoplaySource);
        assert.equal(row.autoplay.defaultRate, 1, 'autoplay native default released');
        row.autoplay.naturalEnded = await evaluate(`const value=document.documentElement.dataset.bs4NaturalEnded;return value===undefined?null:value==='true';`);
        // Same-document transitions retain the event witness. A full navigation
        // loses JS state, but no synthetic ended or load event was dispatched.
        if (row.autoplay.document === 'autoplay') assert.equal(row.autoplay.naturalEnded, true);
        row.ok = true;
      } catch (error) { row.ok = false; row.error = String(error); row.failure = await snapshot().catch(() => null); }
      results.push(row); console.log(JSON.stringify(row));
      await writeFile(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
    }
    for (const multipartAction of (process.env.LIVE_MULTIPART_ACTIONS ?? 'clear,temporary-0.5').split(',').filter(Boolean)) {
      const row = { browser: name, version, extensionVersion, action: `multipart-${multipartAction}` };
      try {
        await navigate('https://www.bilibili.com/video/BV1Kb411W75N/');
        row.current = await release(multipartAction);
        const expected = multipartAction === 'clear' ? 1 : 0.5;
        await execute(`document.documentElement.dataset.bs4AuditDocument='multipart';
          const items=[...document.querySelectorAll('.video-pod__item')];
          const item=items.find(item=>item.textContent.includes('编程入门-资料文件结构1'));
          if(!item)throw new Error('Part 2 item unavailable');item.dataset.bs4AuditPart='';`);
        await pointerClick('[data-bs4-audit-part]');
        await until(`return new URL(location.href).searchParams.get('p')==='2';`, 'part 2 URL');
        row.part2 = await nextIsNormal(row.current, expected);
        // Natural ended on a real multi-part video, including source reuse.
        // The temporary choice already survived part 2. BPX can intentionally
        // no-op a click on that same current speed, without rewriting its default.
        const part3Source = multipartAction.startsWith('temporary-') ? await snapshot() : await release(multipartAction);
        await execute(`const v=document.querySelector('.bpx-player-container video');
          v.muted=true;document.documentElement.dataset.bs4NaturalEnded='false';
          v.addEventListener('ended',()=>document.documentElement.dataset.bs4NaturalEnded='true',{once:true});
          v.play().catch(()=>{});v.currentTime=v.duration-0.2;`);
        await until(`return new URL(location.href).searchParams.get('p')==='3';`, 'natural part 3 autoplay', 240);
        row.part3 = await nextIsNormal(part3Source, expected);
        row.part3.naturalEnded = await evaluate(`const value=document.documentElement.dataset.bs4NaturalEnded;return value===undefined?null:value==='true';`);
        if (row.part3.document === 'multipart') assert.equal(row.part3.naturalEnded, true);
        row.ok = true;
      } catch (error) { row.ok = false; row.error = String(error); row.failure = await snapshot().catch(() => null); }
      results.push(row); console.log(JSON.stringify(row));
      await writeFile(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
    }
  } finally {
    if (session) await session.close();
    if (browser) await browser.close();
  }
}
if (results.some(row => !row.ok)) process.exitCode = 1;
