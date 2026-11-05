import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import '../styles/tokens.css';
import '../styles/base.css';
import { NonceMeta } from '@/ui/NonceMeta';
import { fontVariables } from './fonts';

export const metadata: Metadata = { title: 'Cuenta' };

// Root wiring (D-144): tokens and base styles, the bundled fonts on <html>, html lang from the request's language
// (the lang cookie, else Accept-Language, D-126), and the messages for client components.
// React Aria takes the nonce of its small <style> elements from the csp-nonce meta; NonceMeta keeps the first load's
// nonce across server-action redirects (SF-155).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang={locale} className={fontVariables}>
      <head>
        <NonceMeta nonce={nonce} />
      </head>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
