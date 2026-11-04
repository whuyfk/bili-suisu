import { customRateIndex } from '../src/rate.ts';
import { firefox } from 'playwright';
import { firefoxSession } from './firefox-session.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

await mkdir('docs/screenshots', { recursive: true });
const session = await firefoxSession(firefox.executablePath(), resolve('dist/firefox'));
async function browse() {
  await session.evaluate(`const c=document.querySelector('.bpx-player-ctrl-playbackrate'); if(c.dataset.bs4State==='closed') c.click(); return true;`);
}
async function edit() {
  await browse();
  await session.evaluate(`if(document.querySelector('.bpx-player-ctrl-playbackrate').dataset.bs4State!=='edit') document.querySelector('[data-bs4-trigger]').click(); return true;`);
}
async function expectClosed() {
  assert.equal(await session.evaluate(`return document.querySelector('.bpx-player-ctrl-playbackrate').dataset.bs4State;`), 'closed');
  assert.equal(await session.evaluate(`return getComputedStyle(document.querySelector('[data-bs4-menu]')).display;`), 'none');
}
async function waitSaved(rate, present) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = await session.evaluate(`return !!document.querySelector('[data-bs4-rate="${rate}"]');`);
    if (found === present) return;
    await delay(200);
  }
  throw new Error(`Saved shortcut ${rate} presence did not become ${present}`);
}
async function waitRate(rate) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const actual = await session.evaluate(`return document.querySelector('[data-bs4-menu]') ? document.querySelector('.bpx-player-container video')?.playbackRate : null;`);
    if (actual === rate) return;
    await delay(200);
  }
  throw new Error(`Pinned playback rate did not become ${rate}`);
}
async function waitPin(active) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await session.evaluate(`return document.querySelector('[data-bs4-pin-current]')?.getAttribute('aria-pressed');`);
    if (value === String(active)) return;
    await delay(200);
  }
  throw new Error(`Pin state did not become ${active}`);
}
async function saveRate(rate) {
  await edit();
  await session.evaluate(`const input=document.querySelector('[data-bs4-editor] input'); input.value='${customRateIndex(rate)}'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-bs4-save]').click(); return true;`);
  await waitSaved(rate, true);
  await session.evaluate(`document.querySelector('[data-bs4-editor] .bs4-actions button').click(); return true;`);
}
const { version: extensionVersion } = JSON.parse(await readFile('package.json', 'utf8'));
const results = [];
try {
  console.log('Installed Firefox addon', JSON.stringify(session.installed));
  for (const url of ['https://www.bilibili.com/video/BV1GJ411x7h7/', 'https://www.bilibili.com/bangumi/play/ep317925']) {
    const result = { browser: 'firefox', version: session.capabilities.capabilities.browserVersion,
      url, extensionVersion, mode: 'installed temporary addon (Marionette)' };
    try {
      await session.command('WebDriver:SetWindowRect', { width: 1280, height: 800 });
      await session.command('WebDriver:Navigate', { url });
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        ready = await session.evaluate("return !!document.querySelector('[data-bs4-custom]') && !!document.querySelector('.bpx-player-container video');");
        if (ready) break;
        await delay(500);
      }
      assert.equal(ready, true, 'addon should enhance the live player automatically');
      // Programmatic clicks do not hover the native menu. Focus its keyboard-
      // accessible control first so Firefox can focus the visible custom field.
      await session.evaluate(`document.querySelector('.bpx-player-ctrl-playbackrate').focus(); return true;`);
      const checks = [];
      for (const rate of [2.5, 3, 3.5, 4, 6, 10]) {
        if (rate <= 3) { await browse(); await session.evaluate(`document.querySelector('[data-bs4-rate="${rate}"]').click(); return true;`); }
        else {
          assert.equal(await session.evaluate(`return !!document.querySelector('[data-bs4-rate="${rate}"]');`), false);
          await edit();
          await session.evaluate(`const input=document.querySelector('[data-bs4-custom] input'); input.focus(); input.value='${customRateIndex(rate)}'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return true;`);
        }
        await expectClosed();
        await delay(1200);
        const actual = await session.evaluate("return document.querySelector('.bpx-player-container video').playbackRate;");
        assert.equal(actual, rate);
        checks.push({ requested: rate, actual });
      }
      await edit();
      await session.evaluate(`const input=document.querySelector('[data-bs4-custom] input'); input.focus(); input.value='${customRateIndex(2.8)}'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return true;`);
      await expectClosed();
      await edit();
      await delay(1200);
      result.focusedToolbarOpacity = await session.evaluate(`return getComputedStyle(document.querySelector('.bpx-player-control-bottom')).opacity;`);
      assert.equal(result.focusedToolbarOpacity, '1');
      await delay(1200);
      result.custom = await session.evaluate("return document.querySelector('.bpx-player-container video').playbackRate;");
      assert.equal(result.custom, 2.8);
      await session.evaluate(`document.querySelector('[data-bs4-custom] input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true;`);
      await browse();
      await session.evaluate(`document.querySelector('[data-bs4-menu] [data-value="1.5"]').click(); return true;`);
      await expectClosed();
      await delay(1200);
      result.native = await session.evaluate("return document.querySelector('.bpx-player-container video').playbackRate;");
      assert.equal(result.native, 1.5);
      result.checks = checks;
      result.media = await session.evaluate(`const v=document.querySelector('.bpx-player-container video'); return {rate:v.playbackRate,readyState:v.readyState,paused:v.paused,muted:v.muted,volume:v.volume,preservesPitch:v.preservesPitch};`);
      await edit();
      await session.evaluate(`const input=document.querySelector('[data-bs4-custom] input'); input.focus(); input.value='${customRateIndex(2.8)}'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return true;`);
      await expectClosed();
      result.dismissedAfterSelection = true;
      await saveRate(4.2);
      await session.command('WebDriver:Navigate', { url });
      await waitSaved(4.2, true);
      await browse();
      await session.evaluate(`document.querySelector('[data-bs4-rate="4.2"] .bs4-choice').click(); return true;`);
      assert.equal(await session.evaluate("return document.querySelector('.bpx-player-container video').playbackRate;"), 4.2);
      await browse();
      await session.evaluate(`document.querySelector('[data-bs4-delete="4.2"]').click(); return true;`);
      await waitSaved(4.2, false);
      await saveRate(2.8); await saveRate(6);
      await session.evaluate(`document.querySelector('[data-bs4-clear]').click(); return true;`);
      await waitSaved(2.8, false); await waitSaved(6, false);
      assert.equal(await session.evaluate("return document.querySelector('.bpx-player-container video').playbackRate;"), 4.2);
      result.savedPresets = { persistedAfterReload: true, select: true, delete: true, clear: true };

      await browse();
      await session.evaluate(`document.querySelector('[data-bs4-menu] > [data-value="3"]').click(); return true;`);
      await delay(300);
      await browse();
      await session.evaluate(`document.querySelector('[data-bs4-pin-current]').click(); return true;`);
      await waitPin(true);
      await session.evaluate(`document.querySelector('[data-bs4-menu] > [data-value="1.5"]').click(); return true;`);
      await waitRate(1.5);
      const nextUrl = url.includes('/bangumi/') ? 'https://www.bilibili.com/video/BV1GJ411x7h7/' : 'https://www.bilibili.com/bangumi/play/ep317925';
      await session.command('WebDriver:Navigate', { url: nextUrl });
      await waitRate(3);
      await browse();
      await waitPin(true);
      await session.evaluate(`document.querySelector('[data-bs4-clear]').click(); return true;`);
      await waitPin(false);
      result.pinnedDefault = { nextUrl, restored: 3, temporaryRate: 1.5, clear: true };
      await session.command('WebDriver:Navigate', { url });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await session.evaluate(`return !!document.querySelector('[data-bs4-custom]');`)) break;
        await delay(200);
      }
      await browse();
      const shot = await session.command('WebDriver:TakeScreenshot', { full: false, scroll: false });
      const kind = url.includes('/bangumi/') ? 'bangumi' : 'video';
      await writeFile(`docs/screenshots/firefox-${kind}.png`, Buffer.from(shot.value, 'base64'));
      result.ok = true;
    } catch (error) { result.ok = false; result.error = String(error); }
    results.push(result);
    console.log(JSON.stringify(result));
  }
} finally { await session.close(); }
let previous = [];
try { previous = JSON.parse(await readFile('docs/live-results.json', 'utf8')); } catch { /* first run */ }
await writeFile('docs/live-results.json', `${JSON.stringify([...previous.filter(row => row.browser !== 'firefox'), ...results], null, 2)}\n`);
if (results.some(result => !result.ok)) process.exitCode = 1;
