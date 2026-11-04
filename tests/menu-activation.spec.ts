import { expect, test } from '@playwright/test';
import { actualRate, loadCore, openCustomEditor, openMenu, chooseDraft } from './helpers';

const control = '.bpx-player-ctrl-playbackrate';
const menu = '[data-bs4-menu]';
test.beforeEach(async ({ page }) => { await loadCore(page); });

for (const webFullscreen of [false, true]) {
  for (const rate of [0.5, 3]) {
    test(`refocusing a closed ${rate}x control after ${webFullscreen ? 'web fullscreen' : 'ordinary playback'} does not open it`, async ({ page }) => {
      await openMenu(page); await page.locator(`[data-bs4-menu] > [data-value="${rate}"]`).click();
      if (webFullscreen) await page.locator('#web-fullscreen').click();
      await page.mouse.move(-20, 250);
      // Browsers/sites may restore an element's DOM focus on window re-entry.
      // This must not be interpreted as activating that element's popup.
      await page.locator(control).evaluate(element => { element.blur(); element.focus(); });
      await page.mouse.move(200, 250);
      await expect(page.locator(menu)).toBeHidden();
      await expect(page.locator(control)).toHaveAttribute('aria-expanded', 'false');
      expect(await actualRate(page)).toBe(rate);
      await openMenu(page); await expect(page.locator(menu)).toBeVisible();
    });
  }
}

test('Tab only focuses the control; Enter and Space explicitly open its menu', async ({ page }) => {
  await page.mouse.move(10, 10);
  await page.locator('h1').evaluate(element => { element.tabIndex = 0; element.focus(); });
  // Firefox includes the media element in its native Tab order.
  for (let step = 0; step < 3 && !await page.locator(control).evaluate(element => element === document.activeElement); step++) {
    await page.keyboard.press('Tab');
    await expect(page.locator(menu)).toBeHidden();
  }
  await expect(page.locator(control)).toBeFocused();
  await expect(page.locator(menu)).toBeHidden();
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press(key); await expect(page.locator(menu)).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator(menu)).toBeHidden();
  }
});

test('dismissal while the pointer remains on the button needs a fresh hover before reopening', async ({ page }) => {
  await openMenu(page);
  await page.locator(control).focus(); await page.keyboard.press('Escape');
  const box = (await page.locator(control).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
  await expect(page.locator(menu)).toBeHidden();
  await openMenu(page); await expect(page.locator(menu)).toBeVisible();
});

test('quickly passing across the button does not leave a delayed popup behind', async ({ page }) => {
  const box = (await page.locator(control).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(200, 250);
  await page.waitForTimeout(200);
  await expect(page.locator(menu)).toBeHidden();
  await openMenu(page); await expect(page.locator(menu)).toBeVisible();
});

test('an invisible native hover bridge outside the button cannot open the menu', async ({ page }) => {
  await page.addStyleTag({ content: `${control}::before { content: ''; position: absolute;
    width: 96px; height: 100px; bottom: 100%; left: -20px; opacity: 0; pointer-events: auto; }` });
  const box = (await page.locator(control).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y - 30);
  await expect(page.locator(control)).toHaveAttribute('data-bs4-state', 'closed');
  await expect(page.locator(menu)).toBeHidden();
  await page.locator(control).hover(); await expect(page.locator(menu)).toBeVisible();
});

test('invisible player controls cannot open a popup that appears when the toolbar returns', async ({ page }) => {
  await page.locator('.bpx-player-control-bottom').evaluate(element => { element.style.opacity = '0'; });
  const box = (await page.locator(control).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(control)).toHaveAttribute('data-bs4-state', 'closed');
  await page.mouse.move(200, 250);
  await page.locator('.bpx-player-control-bottom').evaluate(element => { element.style.opacity = '1'; });
  await expect(page.locator(menu)).toBeHidden();
  await openMenu(page); await expect(page.locator(menu)).toBeVisible();
});

test('a deliberate hover still works when BPX first reveals its faded toolbar', async ({ page }) => {
  await page.locator('.bpx-player-control-bottom').evaluate(element => { element.style.opacity = '0'; });
  const box = (await page.locator(control).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.bpx-player-control-bottom').evaluate(element => {
    setTimeout(() => { element.style.opacity = '1'; }, 30);
  });
  await expect(page.locator(menu)).toBeVisible();
});

test('a layout change moving the button under a stationary pointer does not activate it', async ({ page }) => {
  await page.mouse.move(200, 250);
  await page.locator(control).evaluate(element => {
    Object.assign(element.style, { position: 'fixed', left: '180px', top: '240px', width: '60px', height: '30px' });
  });
  await page.waitForTimeout(200);
  await expect(page.locator(menu)).toBeHidden();
  await page.mouse.move(210, 255);
  await expect(page.locator(menu)).toBeVisible();
});

test('window blur discards an editor draft and focus restoration cannot reopen it', async ({ page }) => {
  await openCustomEditor(page); await chooseDraft(page, 4.2);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator(menu)).toBeHidden();
  await page.mouse.move(200, 250);
  await page.locator(control).evaluate(element => { element.blur(); element.focus(); });
  await expect(page.locator(menu)).toBeHidden();
  expect(await actualRate(page)).toBe(1);
  await openCustomEditor(page);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '1');
});
