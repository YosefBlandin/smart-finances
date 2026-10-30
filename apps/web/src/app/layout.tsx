import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import '../styles/tokens.css';
import '../styles/base.css';
import { fontVariables } from './fonts';

export const metadata: Metadata = { title: 'Cuenta' };

// Root wiring (D-144): tokens and base styles, the bundled fonts on <html>, html lang from the request's language
// (the lang cookie, else Accept-Language, D-126), and the messages for client components.
// React Aria adds small <style> elements in the browser (press and scroll handling); it takes their nonce from a
// csp-nonce meta, so the content policy's style-src (no 'unsafe-inline') lets them through.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang={locale} className={fontVariables}>
      <head>{nonce ? <meta name="csp-nonce" nonce={nonce} /> : null}</head>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
