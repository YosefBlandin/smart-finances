import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only: browser specs live in e2e/ and run with Playwright (D-59).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
