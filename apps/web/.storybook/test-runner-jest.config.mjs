// The test runner's Jest settings: Storybook's defaults, plus an optional browser binary from CHROME_PATH for machines
// that have Chromium installed but not the build Playwright expects. CI leaves CHROME_PATH unset and uses Playwright's own.
import { getJestConfig } from '@storybook/test-runner';

const base = getJestConfig();
const chrome = process.env.CHROME_PATH;
const playwright = base.testEnvironmentOptions?.['jest-playwright'] ?? {};

const config = {
  ...base,
  testEnvironmentOptions: {
    ...base.testEnvironmentOptions,
    'jest-playwright': chrome ? { ...playwright, launchOptions: { executablePath: chrome, args: ['--no-sandbox'] } } : playwright,
  },
};

export default config;
