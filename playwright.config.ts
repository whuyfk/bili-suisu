import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { headless: true, viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'chrome', testIgnore: '**/extension.spec.ts', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'edge', testIgnore: '**/extension.spec.ts', use: { browserName: 'chromium', channel: 'msedge' } },
    { name: 'firefox', testIgnore: '**/extension.spec.ts', use: { browserName: 'firefox' } },
    { name: 'installed-chromium-extension', testMatch: '**/extension.spec.ts', use: { browserName: 'chromium' } },
  ],
});
