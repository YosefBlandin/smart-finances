import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Monorepo: trace server files from the repository root so the shared packages are bundled with the app.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  transpilePackages: ['@smart-finances/contracts'],
};

export default config;
