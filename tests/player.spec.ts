import { expect, test } from '@playwright/test';
import { actualRate, loadCore, openMenu, openCustomEditor, setCustomRate, chooseDraft, saveShortcut } from './helpers';

const preset = (rate: number) => `[data-bs4-rate="${rate}"]`;
const customInput = '[data-bs4-custom] input';
const label = '.bpx-player-ctrl-playbackrate-result';

test.beforeEach(async ({ page }) => { await loadCore(page); });

test('adds sorted presets once, selects every preset, and reads actual speed', async ({ page }) => {
  await expect(page.locator('[data-bs4-rate]')).toHaveCount(2);
  await expect(page.locator('[data-bs4-custom]')).toHaveCount(1);
  await expect(page.locator(label)).toHaveText('倍速');
  await expect(page.locator(preset(3))).toHaveText('3.0x');
  const values = await page.locator('.bpx-player-ctrl-playbackrate-menu > [data-value]')
    .evaluateAll(items => items.map(item => Number(item.getAttribute('data-value'))));
  expect(values).toEqual([3, 2.5, 2, 1.5, 1.25, 1, 0.75, 0.5]);
  await openMenu(page);
  for (const rate of [2.5, 3]) {
    await openMenu(page);
    await page.locator(preset(rate)).click();
    await expect.poll(() => actualRate(page)).toBe(rate);
    await expect(page.locator(label)).toHaveText(`${rate}x`);
    await expect(page.locator(preset(rate))).toHaveAttribute('aria-pressed', 'true');
  }
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      const node = document.createElement('span');
      document.querySelector('.bpx-player-container')!.append(node);
      node.remove();
    }
  });
  await expect(page.locator('[data-bs4-rate]')).toHaveCount(2);
  await expect(page.locator('[data-bs4-custom]')).toHaveCount(1);
});

test('preset selection closes immediately and stays closed under native hover and DOM refresh', async ({ page }) => {
  for (const value of ['3', '2.5', '1.5', '1']) {
    await openMenu(page);
    await page.locator(`[data-value="${value}"]`).click();
    await expect(page.locator('[data-bs4-menu]')).toBeHidden();
    await expect.poll(() => actualRate(page)).toBe(Number(value));
    await expect(page.locator(label)).toHaveText(value === '1' ? '倍速' : `${value}x`);
    await page.locator('[data-bs4-menu]').evaluate(menu => { menu.style.display = 'block'; });
    await page.locator('.bpx-player-ctrl-playbackrate-result').evaluate(label => { label.textContent = '倍速'; });
    await expect(page.locator('[data-bs4-menu]')).toBeHidden();
    await expect(page.locator('.bpx-player-ctrl-playbackrate')).toHaveAttribute('aria-expanded', 'false');
  }
});

test('the same selected preset also closes and a fresh hover reopens normally', async ({ page }) => {
  for (let i = 0; i < 2; i++) {
    await openMenu(page);
    await page.locator('[data-value="1"]').click();
    await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  }
  await openMenu(page);
  await expect(page.locator('[data-bs4-menu]')).toBeVisible();
});

test('successful custom Enter and confirm close the menu and release toolbar focus', async ({ page }) => {
  for (const method of ['enter', 'button']) {
    await openCustomEditor(page);
    await chooseDraft(page, '2.8');
    if (method === 'enter') await page.locator(customInput).press('Enter');
    else await page.getByRole('button', { name: '应用', exact: true }).click();
    await expect(page.locator('[data-bs4-menu]')).toBeHidden();
    await expect.poll(() => actualRate(page)).toBe(2.8);
    await page.locator('.bpx-player-control-bottom').evaluate(toolbar => { toolbar.style.opacity = '0'; });
    await expect(page.locator('.bpx-player-control-bottom')).toHaveCSS('opacity', '0');
    // The fixture has no BPX mousemove handler to reveal the faded toolbar.
    await page.locator('.bpx-player-control-bottom').evaluate(toolbar => { toolbar.style.opacity = ''; });
  }
});

test('cancel returns to presets and discards the draft without changing playback', async ({ page }) => {
  await openCustomEditor(page);
  await chooseDraft(page, '3.8');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('[data-bs4-editor]')).toBeHidden();
  await expect(page.locator(preset(3))).toBeVisible();
  expect(await actualRate(page)).toBe(1);
  await page.locator('[data-bs4-trigger]').click();
  await expect(page.locator(customInput)).toHaveAttribute('aria-valuenow', '1');
});

test('after cancel the pointer can dismiss presets even while the trigger retains focus', async ({ page }) => {
  for (const draft of ['3.8', '8.5']) {
    await openCustomEditor(page);
    await chooseDraft(page, draft);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator(preset(3))).toBeVisible();
    await expect(page.locator('[data-bs4-trigger]')).toBeFocused();
    await page.mouse.move(10, 10);
    await expect(page.locator('[data-bs4-menu]')).toBeHidden();
    expect(await actualRate(page)).toBe(1);
  }
  await openMenu(page);
  await page.locator(preset(3)).click();
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  expect(await actualRate(page)).toBe(3);
});

test('outside click and Escape dismiss custom drafts without applying', async ({ page }) => {
  for (const method of ['escape', 'outside', 'tab']) {
    await openCustomEditor(page);
    await chooseDraft(page, '3.8');
    if (method === 'escape') await page.locator(customInput).press('Escape');
    else if (method === 'outside') await page.locator('h1').click();
    else {
      for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    }
    await expect(page.locator('[data-bs4-menu]')).toBeHidden();
    expect(await actualRate(page)).toBe(1);
    await openCustomEditor(page);
    await expect(page.locator(customInput)).toHaveAttribute('aria-valuenow', '1');
    await page.locator(customInput).press('Escape');
  }
});

test('Tab to confirm preserves a slider draft when the real rate changes', async ({ page }) => {
  await openCustomEditor(page);
  await chooseDraft(page, 2.8);
  await page.locator(customInput).press('Tab');
  await page.evaluate(() => { document.querySelector('video')!.playbackRate = 1.5; });
  await expect(page.locator(customInput)).toHaveAttribute('aria-valuenow', '2.8');
  await expect(page.locator('[data-bs4-editor] output')).toHaveText('2.8');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  expect(await actualRate(page)).toBe(2.8);
});

test('keyboard can reopen after confirmation without focus reopening it automatically', async ({ page }) => {
  await openCustomEditor(page);
  await chooseDraft(page, '3.5');
  await page.locator(customInput).press('Enter');
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  const control = page.locator('.bpx-player-ctrl-playbackrate');
  await expect(control).toBeFocused();
  await control.press('Enter');
  await expect(page.locator(preset(3))).toBeVisible();
  await control.press('Escape');
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
});

test('custom Enter and apply button work without leaking player shortcuts', async ({ page }) => {
  await openMenu(page);
  const input = page.locator(customInput);
  await openCustomEditor(page);
  await input.press('End');
  await input.press('ArrowLeft');
  await expect(input).toHaveAttribute('aria-valuenow', '9.9');
  await input.press('Home');
  await input.press('ArrowRight');
  await expect(input).toHaveAttribute('aria-valuenow', '0.3');
  await chooseDraft(page, 2.8);
  await page.keyboard.press('Enter');
  await expect.poll(() => actualRate(page)).toBe(2.8);
  await expect(page.locator(label)).toHaveText('2.8x');
  await expect(page.locator('.bs4-custom-active')).toHaveCount(1);
  await openCustomEditor(page);
  await chooseDraft(page, '0.25');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect.poll(() => actualRate(page)).toBe(0.25);
  expect(await page.evaluate('window.shortcutEvents')).toBe(0);
  await page.locator('video').dispatchEvent('pointerdown');
  await page.evaluate(() => { document.querySelector('video')!.playbackRate = 1.5; });
  await expect(page.locator('[role="status"]')).toBeEmpty();
});

test('slider bounds constrain choices and expose the selected rate accessibly', async ({ page }) => {
  await openCustomEditor(page);
  const slider = page.getByRole('slider');
  await expect(slider).toHaveAttribute('aria-valuemin', '0.25');
  await expect(slider).toHaveAttribute('aria-valuemax', '10');
  await expect(slider).toHaveAttribute('step', '1');
  for (const [draft, expected] of [[-1, 0.25], [11, 10], [0.89, 0.9], [1.37, 1.4], [2.75, 2.8], [2.8, 2.8]]) {
    await chooseDraft(page, draft);
    await expect(slider).toHaveAttribute('aria-valuenow', String(expected));
    await expect(slider).toHaveAttribute('aria-valuetext', `${expected === 0.25 ? expected : expected.toFixed(1)} 倍速`);
    await expect(page.locator('[data-bs4-editor] output')).toHaveText(expected === 0.25 ? String(expected) : expected.toFixed(1));
    expect(await actualRate(page)).toBe(1);
  }
});

test('rates above 3x up to 10x are available only through the custom slider', async ({ page }) => {
  await openMenu(page);
  for (const rate of [3.5, 4, 6, 9.8, 10]) {
    await expect(page.locator(preset(rate))).toHaveCount(0);
    await setCustomRate(page, rate);
    await expect.poll(() => actualRate(page)).toBe(rate);
    await expect(page.locator(label)).toHaveText(`${rate}x`);
    await expect(page.locator('.bs4-custom-active')).toHaveCount(1);
    await expect(page.locator(preset(rate))).toHaveCount(0);
  }
});

test('native-size menu reveals a separate, compact custom editor only on request', async ({ page }) => {
  await openMenu(page);
  await expect(page.locator('[data-bs4-menu]')).toHaveCSS('width', '96px');
  await expect(page.locator('[data-bs4-editor]')).toBeHidden();
  await expect(page.locator('[data-bs4-trigger]')).toBeVisible();
  await openCustomEditor(page);
  await expect(page.locator('[data-bs4-menu]')).toHaveCSS('width', '184px');
  await expect(page.locator(preset(3))).toBeHidden();
  await expect(page.getByRole('button', { name: '应用', exact: true })).toBeVisible();
  const fits = await page.locator('[data-bs4-editor]').evaluate(editor => {
    const input = editor.querySelector('input')!;
    return editor.scrollWidth <= editor.clientWidth && input.getBoundingClientRect().width >= 150;
  });
  expect(fits).toBe(true);
});

test('an untouched custom editor dismisses on pointer leave, including after an earlier edit', async ({ page }) => {
  for (const rate of [1, 2.8]) {
    if (rate !== 1) await setCustomRate(page, rate);
    await openCustomEditor(page);
    await expect(page.locator(customInput)).toBeFocused();
    await expect(page.locator(customInput)).toHaveAttribute('aria-valuenow', String(rate));
    await page.mouse.move(10, 10);
    await expect(page.locator('[data-bs4-menu]')).toBeHidden();
    expect(await actualRate(page)).toBe(rate);
    await page.locator('.bpx-player-control-bottom').evaluate(toolbar => { toolbar.style.opacity = '0'; });
    await expect(page.locator('.bpx-player-control-bottom')).toHaveCSS('opacity', '0');
    await page.locator('.bpx-player-control-bottom').evaluate(toolbar => { toolbar.style.opacity = ''; });
  }
});

test('mouse track selection previews a draft and confirms without leaking player shortcuts', async ({ page }) => {
  await openCustomEditor(page);
  const slider = page.getByRole('slider');
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  const selected = Number(await slider.getAttribute('aria-valuenow'));
  expect(selected).toBeGreaterThan(5);
  expect(selected).toBeLessThan(7);
  expect(selected * 10).toBeCloseTo(Math.round(selected * 10), 8);
  await expect(page.locator('[data-bs4-editor] output')).toHaveText(selected.toFixed(1));
  expect(await actualRate(page)).toBe(1);
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  expect(await actualRate(page)).toBe(selected);
  expect(await page.evaluate('window.shortcutEvents')).toBe(0);
});

test('mouse drag can reach both endpoints without closing during an active drag', async ({ page }) => {
  await openCustomEditor(page);
  const slider = page.getByRole('slider');
  await slider.press('Home');
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 30, box.y + box.height / 2, { steps: 10 });
  await page.waitForTimeout(180);
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute('aria-valuenow', '10');
  await page.mouse.move(box.x - 30, box.y + box.height / 2, { steps: 10 });
  await expect(slider).toHaveAttribute('aria-valuenow', '0.25');
  await page.mouse.up();
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  expect(await actualRate(page)).toBe(1);
});

test('leaving an edited slider discards its draft and releases the toolbar', async ({ page }) => {
  const input = page.locator(customInput);
  await openCustomEditor(page);
  await chooseDraft(page, 2.8);
  await page.evaluate(() => { document.querySelector('video')!.playbackRate = 1.5; });
  await expect(input).toHaveAttribute('aria-valuenow', '2.8');
  await expect(input).toBeVisible();
  await page.locator('.bpx-player-control-bottom').evaluate(toolbar => { toolbar.style.opacity = '0'; });
  await expect(page.locator('.bpx-player-control-bottom')).toHaveCSS('opacity', '1');
  await expect(page.locator(label)).toHaveText('1.5x');
  await page.mouse.move(10, 10);
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  await expect(page.locator('.bpx-player-control-bottom')).toHaveCSS('opacity', '0');
  await expect(input).toHaveAttribute('aria-valuenow', '1.5');
  await expect(page.locator('[data-bs4-editor] output')).toHaveText('1.5');
  expect(await page.evaluate('window.shortcutEvents')).toBe(0);
});

test('native selection cancels pending restore and survives replacement of the video', async ({ page }) => {
  await openMenu(page);
  await setCustomRate(page, 4);
  await openMenu(page);
  await page.locator('[data-value="1.5"]').click();
  await page.evaluate(() => {
    const current = document.querySelector('video')!;
    const next = document.createElement('video');
    next.src = '/sample.webm';
    current.replaceWith(next);
  });
  await expect.poll(() => actualRate(page)).toBe(1.5);
  await page.waitForTimeout(1150);
  expect(await actualRate(page)).toBe(1.5);
});

test('page-only selection survives root and menu reconstruction', async ({ page }) => {
  await openMenu(page);
  await openCustomEditor(page);
  await chooseDraft(page, '2.8');
  await page.locator(customInput).press('Enter');
  await page.evaluate(() => {
    const w = window as unknown as { makePlayer: () => HTMLElement };
    document.querySelector('.bpx-player-container')!.replaceWith(w.makePlayer());
  });
  await expect(page.locator('[data-bs4-rate]')).toHaveCount(2);
  await expect.poll(() => actualRate(page)).toBe(2.8);
  await page.evaluate(() => {
    const w = window as unknown as { nativeMarkup: string; wirePlayer: (root: Element) => void };
    const root = document.querySelector('.bpx-player-container')!;
    const fragment = document.createElement('div');
    fragment.innerHTML = w.nativeMarkup;
    root.querySelector('.bpx-player-control-bottom')!.replaceWith(fragment.querySelector('.bpx-player-control-bottom')!);
    w.wirePlayer(root);
  });
  await expect(page.locator('[data-bs4-custom]')).toHaveCount(1);
  await expect(page.locator(label)).toHaveText('2.8x');
  await openMenu(page);
  await setCustomRate(page, 4);
  expect(await actualRate(page)).toBe(4);
});

test('load metadata restores the selected rate without endless writes', async ({ page }) => {
  await openMenu(page);
  await setCustomRate(page, 4);
  await page.evaluate(() => {
    const video = document.querySelector('video')!;
    video.dispatchEvent(new Event('emptied'));
    video.playbackRate = 1;
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await expect.poll(() => actualRate(page)).toBe(4);
  await page.waitForTimeout(1150);
  await page.evaluate(() => { document.querySelector('video')!.playbackRate = 3; });
  await page.waitForTimeout(1200);
  expect(await actualRate(page)).toBe(3);
  await expect(page.locator(label)).toHaveText('3x');
});

test('long press and keyboard interaction cancel lifecycle recovery', async ({ page }) => {
  await openMenu(page);
  await setCustomRate(page, 4);
  await page.locator('video').dispatchEvent('pointerdown');
  await page.evaluate(() => { document.querySelector('video')!.playbackRate = 2; });
  await page.waitForTimeout(1100);
  expect(await actualRate(page)).toBe(2);
});

test('does not infer a saved selection before the user chooses a rate', async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector('video')!.playbackRate = 1.5;
  });
  await expect(page.locator(label)).toHaveText('1.5x');
  await page.evaluate(() => {
    document.querySelector('video')!.replaceWith(document.createElement('video'));
  });
  await expect(page.locator(label)).toHaveText('倍速');
  expect(await actualRate(page)).toBe(1);
});

test('late native presets replace duplicate enhanced options and preserve sorting', async ({ page }) => {
  await page.evaluate(() => {
    const native = document.createElement('li');
    native.className = 'bpx-player-ctrl-playbackrate-menu-item';
    native.dataset.value = '3.00';
    native.textContent = '3x';
    const menu = document.querySelector('.bpx-player-ctrl-playbackrate-menu')!;
    menu.insertBefore(native, menu.querySelector('[data-bs4-rate="3"]'));
  });
  await expect(page.locator('[data-bs4-rate="3"]')).toHaveCount(0);
  await expect(page.locator('[data-bs4-rate]')).toHaveCount(1);
});

test('bounded menu ignores a stale native tooltip top and stays inside the video', async ({ page }) => {
  await page.locator('[data-bs4-menu]').evaluate(menu => { menu.style.top = '-450px'; });
  await openMenu(page);
  const menu = (await page.locator('[data-bs4-menu]').boundingBox())!;
  const root = (await page.locator('.bpx-player-container').boundingBox())!;
  expect(menu.y).toBeGreaterThanOrEqual(root.y);
  expect(menu.y + menu.height).toBeLessThanOrEqual(root.y + root.height);
  await setCustomRate(page, 4);
  expect(await actualRate(page)).toBe(4);
});

test('supports keyboard selection and fullscreen layouts', async ({ page, browserName }) => {
  await openMenu(page);
  await page.locator(preset(3)).focus();
  await page.locator(preset(3)).press('Enter');
  await expect.poll(() => actualRate(page)).toBe(3);
  await page.locator('#web-fullscreen').click();
  await openMenu(page);
  await expect(page.locator(customInput)).toBeHidden();
  await openCustomEditor(page);
  await chooseDraft(page, '2.8');
  await page.locator(customInput).press('Enter');
  await expect.poll(() => actualRate(page)).toBe(2.8);
  await page.locator('#fullscreen').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await openMenu(page);
  await expect(page.locator(customInput)).toBeHidden();
  // Both Chromium and Gecko enforce real fullscreen user-activation here.
  expect(['chromium', 'firefox']).toContain(browserName);
  const bounds = await page.locator('[data-bs4-menu]').boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  await page.evaluate(() => document.exitFullscreen());
});

for (const rate of [4, 10]) test(`${rate}x advances media time, then pause and seeking preserve the chosen speed`, async ({ page }) => {
  await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
    video.muted = true;
    await video.play();
    video.pause();
    video.currentTime = 1;
  });
  await openMenu(page);
  await setCustomRate(page, rate);
  const progress = await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
    await video.play();
    const start = video.currentTime;
    await new Promise(resolve => setTimeout(resolve, 600));
    video.pause();
    return video.currentTime - start;
  });
  expect(progress).toBeGreaterThan(rate * 0.35);
  expect(progress).toBeLessThan(rate);
  await page.locator('video').evaluate((video: HTMLVideoElement) => { video.currentTime = 12; });
  expect(await actualRate(page)).toBe(rate);
});

test('native audio still produces samples at 4x with pitch correction preserved', async ({ page }) => {
  await openMenu(page);
  await setCustomRate(page, 4);
  const energy = await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
    const audio = new AudioContext();
    const source = audio.createMediaElementSource(video);
    const analyser = audio.createAnalyser();
    const silentOutput = audio.createGain();
    silentOutput.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(audio.destination);
    video.muted = false;
    video.volume = 1;
    await audio.resume();
    await video.play();
    let peak = 0;
    const samples = new Float32Array(analyser.fftSize);
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    }
    video.pause();
    await audio.close();
    return { peak, rate: video.playbackRate, pitch: video.preservesPitch };
  });
  expect(energy.peak).toBeGreaterThan(0.001);
  expect(energy.rate).toBe(4);
  expect(energy.pitch).toBe(true);
});

test('reload drops page memory and extension never writes persistent speed', async ({ page }) => {
  await openMenu(page);
  await setCustomRate(page, 4);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.defaultPlaybackRate)).toBe(1);
  await page.reload();
  await page.addStyleTag({ path: 'dist/chromium/content.css' });
  await page.addScriptTag({ path: 'dist/chromium/content.js' });
  await expect(page.locator('[data-bs4-rate]')).toHaveCount(2);
  expect(await actualRate(page)).toBe(1);
});

test('SPA route exit cleans up and entry discovers a late-created player', async ({ page }) => {
  await page.evaluate(() => {
    history.pushState({}, '', '/');
    document.body.append(document.createElement('div'));
  });
  await expect(page.locator('[data-bs4-custom]')).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as unknown as { makePlayer: () => HTMLElement };
    document.querySelector('.bpx-player-container')!.remove();
    history.pushState({}, '', '/bangumi/play/ep317925');
    document.querySelector('#mount')!.append(w.makePlayer());
  });
  await expect(page.locator('[data-bs4-custom]')).toHaveCount(1);
  await openMenu(page);
  await setCustomRate(page, 4);
  expect(await actualRate(page)).toBe(4);
});

test('missing media and a rejected rate produce errors without false success', async ({ page }) => {
  await openMenu(page);
  await page.locator('video').evaluate(video => video.remove());
  await expect(page.locator('video')).toHaveCount(0);
  await openCustomEditor(page);
  await chooseDraft(page, '2.8');
  await page.locator(customInput).press('Enter');
  await expect(page.locator('[role="status"]')).toContainText('尚未就绪');
  await page.evaluate(() => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'playbackRate', { get: () => 1, set: () => { throw new Error('unsupported'); } });
    document.querySelector('.bpx-player-video-wrap')!.append(video);
  });
  await expect(page.locator(label)).toHaveText('倍速');
  await openCustomEditor(page);
  await chooseDraft(page, '2.8');
  await page.locator(customInput).press('Enter');
  await expect(page.locator('[role="status"]')).toContainText('无法设置');
  await expect(page.locator(label)).toHaveText('倍速');
});


test('native 1.25x is preserved when the custom slider opens at its nearest stop', async ({ page }) => {
  await openMenu(page);
  await page.locator('[data-value="1.25"]').click();
  await openCustomEditor(page);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '1.3');
  await expect(page.locator('[data-bs4-editor] output')).toHaveText('1.3');
  expect(await actualRate(page)).toBe(1.25);
  await page.mouse.move(10, 10);
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  expect(await actualRate(page)).toBe(1.25);
});

test('keyboard steps through every allowed custom rate and back to the quarter-speed stop', async ({ page }) => {
  await openCustomEditor(page);
  const slider = page.getByRole('slider');
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0.25');
  for (let tenth = 3; tenth <= 100; tenth++) {
    await slider.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', String(tenth / 10));
    await expect(page.locator('[data-bs4-editor] output')).toHaveText((tenth / 10).toFixed(1));
  }
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '10');
  await slider.press('Home');
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '0.3');
  await slider.press('ArrowLeft');
  await slider.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '0.25');
  expect(await actualRate(page)).toBe(1);
});


test('icon footer centers custom alone, shows custom / clear together, and exposes concise tooltips', async ({ page }) => {
  await openMenu(page);
  const trigger = page.locator('[data-bs4-trigger]');
  await expect(trigger).toHaveText('');
  await expect(trigger).toHaveAttribute('title', '自定义');
  await expect(trigger).toHaveAttribute('aria-label', '自定义');
  await expect(trigger.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('[data-bs4-clear]')).toBeHidden();
  await expect(page.locator('[data-bs4-separator]')).toBeHidden();
  const single = await page.locator('[data-bs4-footer]').boundingBox();
  const singleButton = await trigger.boundingBox();
  expect(Math.abs(single!.x + single!.width / 2 - singleButton!.x - singleButton!.width / 2)).toBeLessThan(0.5);
  await expect(trigger).toHaveCSS('justify-content', 'center');
  await openCustomEditor(page);
  await chooseDraft(page, 4.2);
  await page.getByRole('button', { name: '添加到倍速栏', exact: true }).click();
  await expect(page.locator('[data-bs4-editor]')).toBeVisible();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('[data-bs4-saved]')).toHaveCount(1);
  await expect(page.locator('[data-bs4-rate="4.2"] .bs4-choice')).toHaveText('4.2x');
  const alignment = await page.locator('[data-bs4-menu]').evaluate(menu => {
    const trigger = menu.querySelector<HTMLElement>('[data-bs4-trigger]')!;
    const clear = menu.querySelector<HTMLElement>('[data-bs4-clear]')!;
    const choose = menu.querySelector<HTMLElement>('.bs4-choice')!;
    const remove = menu.querySelector<HTMLElement>('[data-bs4-delete]')!;
    const center = (node: HTMLElement) => { const rect = node.getBoundingClientRect(); return rect.y + rect.height / 2; };
    return { triggerHeight: trigger.getBoundingClientRect().height, clearHeight: clear.getBoundingClientRect().height,
      triggerFont: getComputedStyle(trigger).fontSize, clearFont: getComputedStyle(clear).fontSize,
      centersDiffer: Math.abs(center(choose) - center(remove)), clearText: clear.textContent,
      triggerY: center(trigger), clearY: center(clear),
      ordered: trigger.getBoundingClientRect().right <= menu.querySelector('[data-bs4-separator]')!.getBoundingClientRect().left
        && menu.querySelector('[data-bs4-separator]')!.getBoundingClientRect().right <= clear.getBoundingClientRect().left };
  });
  expect(alignment.triggerHeight).toBe(alignment.clearHeight);
  expect(alignment.triggerFont).toBe(alignment.clearFont);
  expect(alignment.centersDiffer).toBeLessThan(0.5);
  expect(alignment.clearText).toBe('');
  expect(alignment.triggerY).toBe(alignment.clearY);
  expect(alignment.ordered).toBe(true);
  await expect(page.locator('[data-bs4-clear]')).toHaveAttribute('title', '清空');
  await expect(page.locator('[data-bs4-clear]')).toHaveAttribute('aria-label', '清空');
  await expect(page.locator('[data-bs4-separator]')).toBeVisible();
  await expect(page.locator('[data-bs4-separator]')).toHaveText('/');
  await expect(page.locator('[data-bs4-footer]')).toHaveCSS('height', '36px');

  expect(await actualRate(page)).toBe(1);
  const values = await page.locator('[data-bs4-menu] > [data-value]').evaluateAll(items => items.map(item => Number(item.getAttribute('data-value'))));
  expect(values).toEqual([4.2, 3, 2.5, 2, 1.5, 1.25, 1, 0.75, 0.5]);
  await page.locator('[data-bs4-rate="4.2"] .bs4-choice').click();
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  expect(await actualRate(page)).toBe(4.2);
  await openCustomEditor(page);
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeEnabled();
  await expect(page.locator('[data-bs4-footer]')).toBeHidden();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator('[data-bs4-clear]')).toBeHidden();
  await expect(page.locator('[data-bs4-separator]')).toBeHidden();
  const emptyFooter = await page.locator('[data-bs4-footer]').boundingBox();
  const centeredButton = await trigger.boundingBox();
  expect(Math.abs(emptyFooter!.x + emptyFooter!.width / 2 - centeredButton!.x - centeredButton!.width / 2)).toBeLessThan(0.5);
  expect(await actualRate(page)).toBe(4.2);
});

test('saving native or fixed presets is deduplicated and adding alone does not change playback', async ({ page }) => {
  await openCustomEditor(page);
  for (const rate of [0.5, 1, 1.5, 2, 2.5, 3]) {
    await chooseDraft(page, rate);
    await expect(page.locator('[data-bs4-save]')).toBeDisabled();
  }
  await chooseDraft(page, 0.25);
  await page.locator('[data-bs4-save]').click();
  await expect(page.locator('[data-bs4-saved]')).toHaveCount(1);
  expect(await actualRate(page)).toBe(1);
  await openCustomEditor(page);
  await chooseDraft(page, 0.25);
  await expect(page.locator('[data-bs4-save]')).toBeEnabled();
  await expect(page.locator('[data-bs4-save]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-value="0.25"]')).toHaveCount(1);
});

test('deleting a shortcut does not select it or change the current playback speed', async ({ page }) => {
  for (const rate of [2.8, 4.2]) {
    await saveShortcut(page, rate);
  }
  await page.locator('[data-bs4-rate="4.2"] .bs4-choice').click();
  await openMenu(page);
  await page.getByRole('button', { name: '删除 4.2 倍快捷项', exact: true }).click();
  await expect(page.locator('[data-bs4-rate="4.2"]')).toHaveCount(0);
  await expect(page.locator('[data-bs4-rate="2.8"]')).toHaveCount(1);
  expect(await actualRate(page)).toBe(4.2);
  await expect(page.locator('[data-bs4-menu]')).toBeVisible();
  await page.mouse.move(10, 10);
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
});

test('clear removes all saved shortcuts but preserves native presets and the playing rate', async ({ page }) => {
  for (const rate of [0.25, 4.2, 10]) {
    await saveShortcut(page, rate);
  }
  await page.locator('[data-bs4-rate="4.2"] .bs4-choice').click();
  await openMenu(page);
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator('[data-bs4-saved]')).toHaveCount(0);
  await expect(page.locator('[data-bs4-rate]')).toHaveCount(2);
  await expect(page.locator('[data-bs4-menu] > [data-value]')).toHaveCount(8);
  await expect(page.locator('[data-bs4-clear]')).toBeHidden();
  expect(await actualRate(page)).toBe(4.2);
  await page.mouse.move(10, 10);
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
});

test('saved shortcuts support keyboard selection and deletion without leaking player shortcuts', async ({ page }) => {
  await saveShortcut(page, 4.2);
  await page.locator('[data-bs4-rate="4.2"] .bs4-choice').press('Enter');
  await expect.poll(() => actualRate(page)).toBe(4.2);
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  await openMenu(page);
  await page.getByRole('button', { name: '删除 4.2 倍快捷项', exact: true }).press('Space');
  await expect(page.locator('[data-bs4-saved]')).toHaveCount(0);
  expect(await actualRate(page)).toBe(4.2);
  expect(await page.evaluate('window.shortcutEvents')).toBe(0);
});

test('a failed save keeps the draft editable and does not pretend the shortcut was stored', async ({ page }) => {
  await page.evaluate(() => {
    const api = (globalThis as typeof globalThis & { browser: { storage: { local: { set: () => Promise<void> } } } }).browser;
    api.storage.local.set = async () => { throw new Error('quota'); };
  });
  await openCustomEditor(page);
  await chooseDraft(page, 4.2);
  await page.locator('[data-bs4-save]').click();
  await expect(page.locator('[role="status"]')).toContainText('保存失败');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '4.2');
  await expect(page.locator('[data-bs4-saved]')).toHaveCount(0);
  expect(await actualRate(page)).toBe(1);
});


test('a delayed save does not close a newer draft or reopen a dismissed editor', async ({ page }) => {
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      browser: { storage: { local: { set: (values: Record<string, unknown>) => Promise<void> } } };
      finishPresetSave?: () => Promise<void>;
    };
    const local = scope.browser.storage.local;
    const original = local.set.bind(local);
    local.set = values => new Promise<void>(resolve => {
      scope.finishPresetSave = async () => { await original(values); resolve(); };
    });
  });
  for (const [rate, mode] of [[4.2, 'new-draft'], [4.3, 'dismiss']] as const) {
    await openCustomEditor(page);
    await chooseDraft(page, rate);
    await page.locator('[data-bs4-save]').click();
    await expect(page.locator('[data-bs4-save]')).toBeDisabled();
    if (mode === 'new-draft') await chooseDraft(page, 6);
    else await page.getByRole('slider').press('Escape');
    await page.evaluate(async () => {
      await (globalThis as typeof globalThis & { finishPresetSave: () => Promise<void> }).finishPresetSave();
    });
    await expect(page.locator(`[data-bs4-rate="${rate}"]`)).toHaveCount(1);
    if (mode === 'new-draft') {
      await expect(page.getByRole('slider')).toBeVisible();
      await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '6');
      await expect(page.locator('[data-bs4-save]')).toBeEnabled();
      await page.getByRole('slider').press('Escape');
    } else await expect(page.locator('[data-bs4-menu]')).toBeHidden();
    expect(await actualRate(page)).toBe(1);
  }
});


test('slider click and keyboard adjustment both dismiss on leave without applying or saving', async ({ page }) => {
  for (const action of ['mouse', 'keyboard']) {
    await openCustomEditor(page);
    const slider = page.getByRole('slider');
    if (action === 'mouse') {
      const box = (await slider.boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
    } else await slider.press('End');
    await expect(slider).not.toHaveAttribute('aria-valuenow', '1');
    await page.mouse.move(10, 10);
    await expect(page.locator('[data-bs4-menu]')).toBeHidden();
    expect(await actualRate(page)).toBe(1);
    await expect(page.locator('[data-bs4-saved]')).toHaveCount(0);
    await openCustomEditor(page);
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '1');
    await page.getByRole('slider').press('Escape');
  }
});

test('reentering before the hover grace expires preserves the draft', async ({ page }) => {
  await openCustomEditor(page);
  await chooseDraft(page, 4.2);
  const slider = page.getByRole('slider');
  const box = (await slider.boundingBox())!;
  await page.mouse.move(10, 10);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(160);
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute('aria-valuenow', '4.2');
  await page.mouse.move(10, 10);
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  expect(await actualRate(page)).toBe(1);
});


test('favorite star toggles in place, stays beside centered numbers and never applies playback', async ({ page }) => {
  await openCustomEditor(page);
  const star = page.locator('[data-bs4-save]');
  for (const rate of [0.25, 2.8, 10]) {
    await chooseDraft(page, rate);
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    const geometry = await page.locator('.bs4-value-field').evaluate(field => {
      const group = field.querySelector('.bs4-rate-value')!.getBoundingClientRect();
      const star = field.querySelector('[data-bs4-save]')!.getBoundingClientRect();
      const outer = field.getBoundingClientRect();
      return { center: Math.abs(group.x + group.width / 2 - outer.x - outer.width / 2),
        gap: star.left - group.right, bottomFits: star.bottom <= outer.bottom };
    });
    expect(geometry.center).toBeLessThan(0.5);
    expect(geometry.gap).toBeGreaterThan(2);
    expect(geometry.bottomFits).toBe(true);
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(star).toHaveCSS('color', 'rgb(251, 114, 153)');
    await expect(star.locator('svg')).toHaveCSS('fill', 'rgb(251, 114, 153)');
    await expect(page.locator(`[data-bs4-saved][data-value="${rate}"]`)).toHaveCount(1);
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', String(rate));
    expect(await actualRate(page)).toBe(1);
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-bs4-saved]')).toHaveCount(0);
    await expect(page.locator('[data-bs4-editor]')).toBeVisible();
    expect(await actualRate(page)).toBe(1);
  }
});

test('keyboard favorite toggle is isolated and mouse leave keeps committed shortcuts only', async ({ page }) => {
  await openCustomEditor(page);
  await chooseDraft(page, 4.2);
  const star = page.locator('[data-bs4-save]');
  await star.press('Enter');
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await star.press('Space');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.press('Enter');
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  // Move into the editor before leaving: keyboard activation itself does not hover.
  await page.getByRole('slider').hover();
  await page.mouse.move(10, 10);
  await expect(page.locator('[data-bs4-menu]')).toBeHidden();
  await expect(page.locator('[data-bs4-saved][data-value="4.2"]')).toHaveCount(1);
  expect(await actualRate(page)).toBe(1);
  expect(await page.evaluate('window.shortcutEvents')).toBe(0);
});
