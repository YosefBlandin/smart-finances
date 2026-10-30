import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { fileURLToPath } from 'node:url';

// next-intl without locale routing: the plugin points every server component at the request config (D-126, D-144).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Monorepo: trace server files from the repository root so the shared packages are bundled with the app.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  transpilePackages: ['@smart-finances/contracts'],
};

export default withNextIntl(config);
