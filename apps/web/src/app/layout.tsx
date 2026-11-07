import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import '../styles/tokens.css';
import '../styles/base.css';
import { getContainer } from '@/adapters/container';
import { NonceMeta } from '@/ui/NonceMeta';
import { fontVariables } from './fonts';
import { Rum, type RumSettings } from './rum';

export const metadata: Metadata = { title: 'Cuenta' };

// Root wiring (D-144): tokens and base styles, the bundled fonts on <html>, html lang from the request's language
// (the lang cookie, else Accept-Language, D-126), and the messages for client components.
// React Aria takes the nonce of its small <style> elements from the csp-nonce meta; NonceMeta keeps the first load's
// nonce across server-action redirects (SF-155). Browser monitoring (SF-172; D-135, D-162): the RUM ids are stage
// parameters read here through ParameterStore (cached 60 s) and handed to the Rum client component; under STAGE=test, or
// when one is missing or cannot be read, RUM stays off and the page renders as usual.
async function rumSettings(): Promise<RumSettings | null> {
  try {
    const { settings, parameterStore } = getContainer();
    const { STAGE, REGION, COMMIT_SHA } = settings.get();
    if (STAGE === 'test') return null;
    const read = (name: string) => parameterStore.get(`/smart-finances/${STAGE}/${name}`);
    const [appMonitorId, identityPoolId, guestRoleArn] = await Promise.all([
      read('rum-app-monitor-id'),
      read('rum-identity-pool-id'),
      read('rum-guest-role-arn'),
    ]);
    if (!appMonitorId || !identityPoolId || !guestRoleArn) return null;
    return { appMonitorId, identityPoolId, guestRoleArn, region: REGION, version: COMMIT_SHA };
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const rum = await rumSettings();
  return (
    <html lang={locale} className={fontVariables}>
      <head>
        <NonceMeta nonce={nonce} />
      </head>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <Rum settings={rum} />
      </body>
    </html>
  );
}
