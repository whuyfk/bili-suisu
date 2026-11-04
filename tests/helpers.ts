import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { customRateIndex } from '../src/rate.ts';
import type { BrowserContext, Page } from '@playwright/test';

export const fixtureUrl = 'https://www.bilibili.com/video/BVfixture/';
export async function serveFixture(target: Page | BrowserContext): Promise<void> {
  const html = await readFile(resolve('tests/fixtures/player.html'));
  await target.route('https://www.bilibili.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/sample.webm') {
      await route.fulfill({ path: resolve('tests/fixtures/sample.webm'), contentType: 'video/webm' });
    } else if (route.request().resourceType() === 'document') {
      await route.fulfill({ body: html, contentType: 'text/html' });
    } else await route.abort();
  });
}

export async function loadCore(page: Page, path = '/video/BVfixture/'): Promise<void> {
  await serveFixture(page);
  // Isolated core tests emulate extension storage without touching site storage.
  // Installed-package tests below exercise the actual browser APIs and persistence.
  await page.addInitScript(() => {
    const data: Record<string, unknown> = {};
    const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
    const emit = (changes: Record<string, { newValue?: unknown }>) => listeners.forEach(fn => fn(changes, 'local'));
    Object.defineProperty(globalThis, 'browser', { configurable: true, value: { storage: {
      local: {
        async get(keys: string[]) { return Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]])); },
        async set(values: Record<string, unknown>) {
          Object.assign(data, values);
          emit(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])));
        },
        async remove(keys: string[]) {
          keys.forEach(key => { delete data[key]; });
          emit(Object.fromEntries(keys.map(key => [key, {}])));
        },
      },
      onChanged: { addListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.add(fn),
        removeListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(fn) },
    } } });
  });
  await page.goto(`https://www.bilibili.com${path}`);
  await page.addStyleTag({ path: resolve('dist/chromium/content.css') });
  await page.addScriptTag({ path: resolve('dist/chromium/content.js') });
}

export async function openMenu(page: Page): Promise<void> {
  await page.mouse.move(10, 10);
  await page.locator('.bpx-player-ctrl-playbackrate').hover();
  await page.locator('[data-bs4-menu]').waitFor({ state: 'visible' });
}

export async function actualRate(page: Page): Promise<number> {
  return page.locator('video').evaluate((video: HTMLVideoElement) => video.playbackRate);
}

export async function openCustomEditor(page: Page): Promise<void> {
  if (await page.locator('[data-bs4-editor]').isVisible()) return;
  await openMenu(page);
  await page.locator('[data-bs4-trigger]').click();
  await page.locator('[data-bs4-editor]').waitFor({ state: 'visible' });
}

/** Controller scenarios use an exact draft; pointer mechanics have dedicated tests. */
export async function chooseDraft(page: Page, rate: number | string): Promise<void> {
  const slider = page.locator('[data-bs4-custom] input');
  await slider.focus();
  await slider.evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, customRateIndex(Number(rate)));
}

export async function setCustomRate(page: Page, rate: number): Promise<void> {
  await openCustomEditor(page);
  const input = page.locator('[data-bs4-custom] input');
  await chooseDraft(page, rate);
  await input.press('Enter');
}


/** Favorite immediately, then return to the preset list without applying the draft. */
export async function saveShortcut(page: Page, rate: number): Promise<void> {
  await openCustomEditor(page);
  await chooseDraft(page, rate);
  await page.locator('[data-bs4-save]').click();
  await page.locator(`[data-bs4-saved][data-value="${rate}"]`).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
}
