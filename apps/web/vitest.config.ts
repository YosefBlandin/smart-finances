import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only: browser specs live in e2e/ and run with Playwright (D-59).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // tsconfig keeps jsx as preserve for Next.js; tests compile JSX with the automatic runtime (owner decision in SF-110).
  oxc: { jsx: { runtime: 'automatic' } },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
