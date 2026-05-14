import { defineConfig, devices } from '@playwright/test';

/**
 * Comprehensive E2E config.
 *
 * - testDir points at the project's `e2e/` directory (the new comprehensive
 *   suite). The older smoke tests under `tests/e2e/` are still picked up via
 *   `testMatch` so we don't lose them.
 * - Default headless. CI gets 1 retry to dampen flakes; locally none.
 * - Single project (chromium) by default — flip MOBILE=1 to also run iPhone.
 *   The mobile project is opt-in because some specs poke desktop-only layout.
 */
export default defineConfig({
  testDir: './',
  testMatch: ['e2e/**/*.spec.ts', 'tests/e2e/**/*.spec.ts'],
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    headless: true
  },
  projects: process.env.MOBILE
    ? [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile', use: { ...devices['iPhone 14 Pro'] } }
      ]
    : [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : { command: 'npm run dev', port: 3000, reuseExistingServer: !process.env.CI, timeout: 120_000 }
});
