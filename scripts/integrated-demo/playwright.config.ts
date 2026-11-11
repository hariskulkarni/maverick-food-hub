import { defineConfig } from '@playwright/test';

// Integrated demo recorder (LOCAL ONLY). System Chrome, one worker, every context records video.
// Output dir comes from DEMO_OUT (up.sh sets it to ~/flavrly-pg-evidence/<date>/integrated-demo).
export default defineConfig({
  testDir: '.',
  testMatch: ['demo.spec.ts'],
  timeout: 60 * 60_000,
  workers: 1,
  reporter: [['list']],
  expect: { timeout: 180_000 },
  outputDir: `${process.env.DEMO_OUT ?? 'demo-out'}/playwright-artifacts`,
  use: {
    channel: 'chrome',
    // Novaryq business hosts (<tenant>.novaryq.test) resolve to the local vite server inside the demo browser only.
    launchOptions: { args: ['--host-resolver-rules=MAP *.novaryq.test 127.0.0.1'] },
    headless: true,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    // A Next dev server compiles each route on first use (30–60 s on a busy machine).
    actionTimeout: 300_000,
    navigationTimeout: 600_000,
    screenshot: 'only-on-failure',
  },
});
