// E2E tests (NF-29, Kap. 9.1) against the production build with active CSP. Every worker starts its own
// server with a temporary DATA_DIR (tests/e2e/fixtures.ts), so specs never share data.
// Run: `pnpm e2e` (builds first) or, with a current dist/client, `pnpm exec playwright test`.
// Tests pick their devices with tags in the title: @phone, @tablet, @desktop.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/e2e',
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 3,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Android phone (Chrome), 412×839 at DPR 2.625.
    { name: 'phone-chromium', grep: /@phone/, use: { ...devices['Pixel 7'] } },
    // iPhone (Safari engine), 390×664 at DPR 3.
    { name: 'phone-webkit', grep: /@phone/, use: { ...devices['iPhone 14'] } },
    // iPad in landscape (two panes); portrait tests switch with page.setViewportSize({ width: 768, height: 1024 }).
    {
      name: 'tablet-webkit',
      grep: /@tablet/,
      use: {
        ...devices['iPad (gen 7)'],
        viewport: { width: 1024, height: 768 },
      },
    },
    // Windows PC.
    {
      name: 'desktop-chromium',
      grep: /@desktop/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
