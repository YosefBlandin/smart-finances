// Storybook for the design-system parts and, later, every screen state (D-129). Runs locally and in CI only; nothing is
// published (D-136). The accessibility add-on checks every story; the test runner fails on any violation (preview.tsx).
import type { StorybookConfig } from '@storybook/nextjs';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  framework: { name: '@storybook/nextjs', options: {} },
  core: { disableTelemetry: true },
};

export default config;
