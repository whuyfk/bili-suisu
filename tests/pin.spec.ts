import { expect, test, type Page } from '@playwright/test';
import type { PresetStorage } from '../src/presets';
import { actualRate, chooseDraft, loadCore, openCustomEditor, openMenu, saveShortcut } from './helpers';

const pin = '[data-bs4-pin-current]';
async function select(page: Page, rate: number): Promise<void> {
  await openMenu(page);
  await page.locator(`[data-value="${rate}"]`).click();
  await expect.poll(() => actualRate(page)).toBe(rate);
}
async function fixCurrent(page: Page): Promise<void> {
  await openMenu(page);
  await page.locator(pin).click();
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'true');
}

test.beforeEach(async ({ page }) => { await loadCore(page); });

test('unpinned icons only show on row hover, a pinned icon stays visible, and custom hover is blue', async ({ page }) => {
  await select(page, 3);
  await openMenu(page);
  await expect(page.locator(pin)).toHaveCount(1);
  await expect(page.locator('[data-value="3"] > [data-bs4-pin]')).toBeVisible();
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(pin)).toHaveCSS('color', 'rgb(148, 154, 165)');
  await expect(page.locator(pin)).toHaveCSS('opacity', '0');
  await page.locator('[data-value="3"]').hover();
  await expect(page.locator(pin)).toHaveCSS('opacity', '1');
  await page.locator('[data-bs4-trigger]').hover();
  await expect(page.locator(pin)).toHaveCSS('opacity', '0');
  await expect(page.locator('[data-bs4-trigger]')).toHaveCSS('color', 'rgb(0, 174, 236)');
  await page.locator(pin).click();
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(pin)).toHaveCSS('color', 'rgb(0, 174, 236)');
  await expect(page.locator(pin).locator('svg')).toHaveCSS('fill', 'rgb(0, 174, 236)');
  await expect(page.locator('[data-bs4-menu]')).toBeVisible();
  expect(await actualRate(page)).toBe(3);
  await page.locator('[data-bs4-trigger]').hover();
  await expect(page.locator(pin)).toHaveCSS('opacity', '1');
  // The fixed default stays visible even while another speed plays.
  await select(page, 1.5);
  await openMenu(page);
  await expect(page.locator('[data-value="3"] > [data-bs4-pin]')).toHaveCSS('opacity', '1');
  await expect(page.locator(pin)).toHaveCSS('opacity', '0');
  await select(page, 3);
  await openMenu(page);
  await page.locator('[data-value="3"]').hover();
  await page.locator('[data-value="3"] > [data-bs4-pin]').click();
  await expect(page.locator('[data-value="3"] > [data-bs4-pin]')).toHaveAttribute('aria-pressed', 'false');
  expect(await actualRate(page)).toBe(3);
  await page.locator('[data-bs4-trigger]').hover();
  await expect(page.locator(pin)).toHaveCSS('opacity', '0');
  await select(page, 1.25);
  await openMenu(page);
  await expect(page.locator('[data-value="1.25"] > [data-bs4-pin]')).toBeVisible();
  await expect(page.locator('[data-value="1.25"]')).toHaveText('1.25x');
  await expect(page.locator(pin)).toHaveCount(1);
  // Selected saved rows are blue, but their unpinned icon must stay gray.
  await saveShortcut(page, 4.2);
  await select(page, 4.2); await openMenu(page);
  const savedRow = page.locator('[data-value="4.2"]');
  const savedPin = savedRow.locator('[data-bs4-pin]');
  await savedRow.hover();
  await expect(savedRow.locator('.bs4-choice')).toHaveCSS('color', 'rgb(0, 174, 236)');
  await expect(savedPin).toHaveCSS('color', 'rgb(148, 154, 165)');
  await expect(savedPin.locator('svg')).toHaveCSS('fill', 'none');
  await savedPin.hover();
  await expect(savedPin).toHaveCSS('color', 'rgb(0, 174, 236)');
  await expect(savedPin.locator('svg')).toHaveCSS('fill', 'none');
  await savedRow.hover();
  await expect(savedPin).toHaveCSS('color', 'rgb(148, 154, 165)');
  await savedPin.click();
  await expect(savedPin).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-bs4-trigger]').hover();
  await expect(savedPin).toHaveCSS('color', 'rgb(0, 174, 236)');
  await expect(savedPin.locator('svg')).toHaveCSS('fill', 'rgb(0, 174, 236)');
});

test('a pinned default wins on video replacement while manual selection only affects the current media', async ({ page }) => {
  await select(page, 3); await fixCurrent(page);
  await select(page, 1.5);
  await page.waitForTimeout(1100);
  expect(await actualRate(page)).toBe(1.5);
  await page.evaluate(() => {
    const next = document.createElement('video');
    next.src = '/sample.webm';
    document.querySelector('video')!.replaceWith(next);
  });
  await expect.poll(() => actualRate(page)).toBe(3);
});

test('a pinned default is restored on SPA navigation and a new source without an endless rate lock', async ({ page }) => {
  await select(page, 3); await fixCurrent(page);
  await select(page, 2.5);
  await page.evaluate(() => {
    history.pushState({}, '', '/video/BVnext/?p=2');
    document.body.append(document.createElement('span'));
  });
  await expect.poll(() => actualRate(page)).toBe(3);
  await select(page, 1.5);
  await page.evaluate(() => {
    const video = document.querySelector('video')!;
    video.dispatchEvent(new Event('emptied'));
    video.playbackRate = 1;
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await expect.poll(() => actualRate(page)).toBe(3);
  await page.waitForTimeout(1150);
  await page.evaluate(() => { document.querySelector('video')!.playbackRate = 2; });
  await page.waitForTimeout(1100);
  expect(await actualRate(page)).toBe(2);
});

test('deleting the pinned custom shortcut clears the pin while unrelated deletion preserves it', async ({ page }) => {
  await saveShortcut(page, 4.2); await saveShortcut(page, 6);
  await select(page, 4.2); await fixCurrent(page);
  await page.getByRole('button', { name: '删除 6 倍快捷项', exact: true }).click();
  await expect(page.locator('[data-value="6"]')).toHaveCount(0);
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '删除 4.2 倍快捷项', exact: true }).click();
  await expect(page.locator('[data-value="4.2"]')).toHaveCount(0);
  expect(await actualRate(page)).toBe(4.2);
  await openCustomEditor(page);
  await expect(page.locator('[data-bs4-editor] [data-bs4-pin]')).toHaveCount(0);
  const stored = await page.evaluate(async () => {
    const storage = (globalThis as typeof globalThis & { browser: { storage: PresetStorage } }).browser.storage;
    return storage.local.get(['biliSuisu.pinnedRate']);
  });
  expect(stored).toEqual({});
});

test('clear also removes a native pin when no favorites exist, without changing playback', async ({ page }) => {
  await select(page, 3); await fixCurrent(page);
  await expect(page.locator('[data-bs4-saved]')).toHaveCount(0);
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-bs4-clear]')).toBeHidden();
  expect(await actualRate(page)).toBe(3);
  const stored = await page.evaluate(async () => {
    const storage = (globalThis as typeof globalThis & { browser: { storage: PresetStorage } }).browser.storage;
    return storage.local.get(['biliSuisu.pinnedRate']);
  });
  expect(stored).toEqual({});
});

for (const action of ['unpin', 'clear', 'delete'] as const) {
  test(`${action} releases the old pin on SPA navigation, reused media and player reconstruction`, async ({ page }) => {
    await saveShortcut(page, 4.2);
    await select(page, 4.2); await fixCurrent(page);
    if (action === 'unpin') await page.locator(pin).click();
    else if (action === 'clear') await page.getByRole('button', { name: '清空', exact: true }).click();
    else await page.getByRole('button', { name: '删除 4.2 倍快捷项', exact: true }).click();
    await expect(page.locator('[data-bs4-pin][aria-pressed="true"]')).toHaveCount(0);
    expect(await actualRate(page)).toBe(4.2);

    // BPX can reuse the video element and leave its old playbackRate in place.
    await page.evaluate(() => {
      history.pushState({}, '', '/video/BVafterUnpin/?p=2');
      document.body.append(document.createElement('span'));
    });
    await expect.poll(() => actualRate(page)).toBe(1);
    await page.evaluate(() => {
      const video = document.querySelector('video')!;
      video.dispatchEvent(new Event('emptied'));
      video.playbackRate = 1;
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    await page.waitForTimeout(1150);
    expect(await actualRate(page)).toBe(1);
    await page.evaluate(() => {
      const w = window as unknown as { makePlayer: () => HTMLElement };
      document.querySelector('.bpx-player-container')!.replaceWith(w.makePlayer());
    });
    await expect.poll(() => actualRate(page)).toBe(1);

    // Unpinning does not disable ordinary page-only choices made afterwards.
    await select(page, 2.5);
    await page.evaluate(() => { document.querySelector('video')!.replaceWith(document.createElement('video')); });
    await expect.poll(() => actualRate(page)).toBe(2.5);
  });
}

test('unpinning does not reset the current video on late metadata but releases a replacement video', async ({ page }) => {
  await select(page, 3); await fixCurrent(page);
  await page.locator(pin).click();
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { document.querySelector('video')!.dispatchEvent(new Event('loadedmetadata')); });
  await page.waitForTimeout(1150);
  expect(await actualRate(page)).toBe(3);
  await page.evaluate(() => { document.querySelector('video')!.replaceWith(document.createElement('video')); });
  await expect.poll(() => actualRate(page)).toBe(1);
});

test('clear releases a reused source without URL changes and later manual choices keep working', async ({ page }) => {
  await select(page, 3); await fixCurrent(page);
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'false');
  expect(await actualRate(page)).toBe(3);
  await page.evaluate(() => {
    const video = document.querySelector('video')!;
    video.dispatchEvent(new Event('emptied'));
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await expect.poll(() => actualRate(page)).toBe(1);
  await page.waitForTimeout(1150);
  await select(page, 3); await fixCurrent(page);
  await page.locator(pin).click();
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'false');
  await select(page, 2.5);
  await page.evaluate(() => { document.querySelector('video')!.replaceWith(document.createElement('video')); });
  await expect.poll(() => actualRate(page)).toBe(2.5);
});

test('a failed unpin preserves the default for the next video', async ({ page }) => {
  await select(page, 3); await fixCurrent(page);
  await page.evaluate(() => {
    const local = (globalThis as typeof globalThis & { browser: { storage: PresetStorage } }).browser.storage.local;
    local.remove = async () => { throw new Error('storage unavailable'); };
  });
  await page.locator(pin).click();
  await expect(page.locator('[role="status"]')).toContainText('保存失败');
  await page.evaluate(() => { document.querySelector('video')!.replaceWith(document.createElement('video')); });
  await expect.poll(() => actualRate(page)).toBe(3);
});

test('the custom editor never contains a pin, including actual, drafted and fixed values', async ({ page }) => {
  await select(page, 3); await fixCurrent(page);
  await openCustomEditor(page);
  await expect(page.locator(pin)).toHaveCount(0);
  await chooseDraft(page, 4.2);
  await expect(page.locator(pin)).toHaveCount(0);
  await page.locator('[data-bs4-save]').click();
  await expect(page.locator('[data-bs4-save]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(pin)).toHaveCount(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('[data-value="4.2"]').hover();
  await page.locator('[data-value="4.2"] > [data-bs4-pin]').click();
  await expect.poll(() => actualRate(page)).toBe(4.2);
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'true');
  await openCustomEditor(page);
  await expect(page.locator(pin)).toHaveCount(0);
});

test('hovering a native or saved row reveals its pin and one click selects and persists it', async ({ page }) => {
  await saveShortcut(page, 4.2);
  await select(page, 1.5); await openMenu(page);
  for (const rate of [3, 4.2, 1.25]) {
    await page.locator(`[data-value="${rate}"]`).hover();
    const rowPin = page.locator(`[data-value="${rate}"] > [data-bs4-pin]`);
    await expect(rowPin).toBeVisible();
    await expect(rowPin).toHaveAttribute('aria-pressed', 'false');
    expect(await actualRate(page)).not.toBe(rate);
    await rowPin.click();
    await expect(rowPin).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => actualRate(page)).toBe(rate);
    const stored = await page.evaluate(async () => {
      const storage = (globalThis as typeof globalThis & { browser: { storage: PresetStorage } }).browser.storage;
      return storage.local.get(['biliSuisu.pinnedRate']);
    });
    expect(stored['biliSuisu.pinnedRate']).toBe(rate);
    await expect(page.locator('[data-bs4-menu]')).toBeVisible();
  }
});

test('saved delete controls appear only on the hovered row or keyboard focus', async ({ page }) => {
  await saveShortcut(page, 4.2); await saveShortcut(page, 6);
  await openMenu(page);
  const four = page.locator('[data-value="4.2"]');
  const six = page.locator('[data-value="6"]');
  await expect(four.locator('[data-bs4-delete]')).toHaveCSS('opacity', '0');
  await four.hover();
  await expect(four.locator('[data-bs4-delete]')).toHaveCSS('opacity', '1');
  await expect(six.locator('[data-bs4-delete]')).toHaveCSS('opacity', '0');
  await six.hover();
  await expect(four.locator('[data-bs4-delete]')).toHaveCSS('opacity', '0');
  await expect(six.locator('[data-bs4-delete]')).toHaveCSS('opacity', '1');
  await page.locator('[data-bs4-trigger]').hover();
  await expect(six.locator('[data-bs4-delete]')).toHaveCSS('opacity', '0');
  await four.locator('[data-bs4-delete]').focus();
  await expect(four.locator('[data-bs4-delete]')).toHaveCSS('opacity', '1');
  await four.locator('[data-bs4-delete]').press('Enter');
  await expect(four).toHaveCount(0);
});

test('clear remains visible when reopening a menu with only a native pin', async ({ page }) => {
  await select(page, 1.5); await fixCurrent(page);
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(10, 10);
    await expect(page.locator('[data-bs4-menu]')).toBeHidden();
    await openMenu(page);
    await expect(page.locator('[data-bs4-clear]')).toBeVisible();
    await page.locator('[data-value="0.75"]').hover();
    await expect(page.locator('[data-bs4-clear]')).toBeVisible();
    await openCustomEditor(page);
    await expect(page.locator('[data-bs4-clear]')).toBeHidden();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('[data-bs4-clear]')).toBeVisible();
  }
  await page.locator('[data-bs4-clear]').click();
  await expect(page.locator('[data-bs4-clear]')).toBeHidden();
  expect(await actualRate(page)).toBe(1.5);
});

test('keyboard pin operations do not trigger preset selection or player shortcuts', async ({ page }) => {
  await select(page, 3); await openMenu(page);
  await page.locator(pin).press('Enter');
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-bs4-menu]')).toBeVisible();
  await page.locator(pin).press('Space');
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'false');
  expect(await actualRate(page)).toBe(3);
  expect(await page.evaluate('window.shortcutEvents')).toBe(0);
});

test('a failed pin write leaves the pin gray and reports the failure', async ({ page }) => {
  await page.evaluate(() => {
    const local = (globalThis as typeof globalThis & { browser: { storage: PresetStorage } }).browser.storage.local;
    local.set = async () => { throw new Error('quota'); };
  });
  await select(page, 3); await openMenu(page);
  await page.locator(pin).click();
  await expect(page.locator('[role="status"]')).toContainText('保存失败');
  await expect(page.locator(pin)).toHaveCount(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator(pin)).toHaveAttribute('aria-pressed', 'false');
  expect(await actualRate(page)).toBe(3);
});

test('a late preference read does not override a deliberate selection but applies to the next video', async ({ page }) => {
  await page.reload();
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      browser: { storage: PresetStorage }; finishPinRead: (data: Record<string, unknown>) => void;
    };
    scope.browser.storage.local.get = () => new Promise(resolve => { scope.finishPinRead = resolve; });
  });
  await page.addStyleTag({ path: 'dist/chromium/content.css' });
  await page.addScriptTag({ path: 'dist/chromium/content.js' });
  await select(page, 2.5);
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { finishPinRead: (data: Record<string, unknown>) => void }).finishPinRead({ 'biliSuisu.pinnedRate': 3 });
  });
  await expect(page.locator('[data-bs4-clear]')).toBeAttached();
  expect(await actualRate(page)).toBe(2.5);
  await page.evaluate(() => { document.querySelector('video')!.replaceWith(document.createElement('video')); });
  await expect.poll(() => actualRate(page)).toBe(3);
});
