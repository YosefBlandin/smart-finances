import { defineConfig } from '@playwright/test';

// Browser specs run against `next dev` with STAGE=test, so no cloud setting is needed (D-59).
// Locally they use the installed Chrome; CI uses the Chromium that `playwright install` provides.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3000', channel: process.env.CI ? undefined : 'chrome' },
  webServer: {
    command: 'next dev -p 3000',
    url: 'http://localhost:3000/api/health',
    env: { STAGE: 'test', NEXT_TELEMETRY_DISABLED: '1' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
