import { defineConfig } from '@playwright/test';

// Browser specs run against a production build (`next build` + `next start`) with STAGE=test, so no cloud setting is
// needed (D-59) and the strict content policy is what gets tested: `next dev` needs 'unsafe-eval', which the policy
// refuses (owner decision, SF-111 deviation). A running dev server is never reused, so it cannot stand in for the build.
// Locally they use the installed Chrome; CI uses the Chromium that `playwright install` provides.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3000', channel: process.env.CI ? undefined : 'chrome' },
  webServer: {
    command: 'next build && next start -p 3000',
    url: 'http://localhost:3000/api/health',
    env: { STAGE: 'test', NEXT_TELEMETRY_DISABLED: '1' },
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
