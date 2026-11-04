import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getContainer } from '@/adapters/container';
import { createSignIn } from '@/application/auth/signIn';
import { readPreAuthCookie } from '../../../cookies';
import styles from '../../../states.module.css';
import { SetupForm } from '../forms';
import own from '../signIn.module.css';

// Set up the authenticator (AC-13): the first sign-in shows the new key as a QR code drawn on the server as SVG (no
// script, no image request) and as text, then asks for the first code. No money screen opens before this is done. Without
// a live setup row (15 minutes, D-91) the person starts again at the password step.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.setup');
  return { title: `${t('title')} · Cuenta` };
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view = await createSignIn(getContainer()).setupView(await readPreAuthCookie());
  if (!view) redirect('/sign-in');
  const { next } = await searchParams;
  const t = await getTranslations('auth');
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>cuenta</p>
        <h1 className={styles.title} tabIndex={-1}>
          {t('setup.title')}
        </h1>
        <p className={styles.lead}>{t('setup.lead')}</p>
        <p className={own.small}>{t('setup.required')}</p>
        <ol className={own.steps}>
          <li>{t('setup.step1')}</li>
          <li>{t('setup.step2')}</li>
        </ol>
        <svg className={own.qr} viewBox={`0 0 ${view.qr.size} ${view.qr.size}`} role="img" aria-label={t('setup.qrAlt')} shapeRendering="crispEdges">
          <rect className={own.qrLight} width={view.qr.size} height={view.qr.size} />
          <path className={own.qrDark} d={view.qr.path} />
        </svg>
        <p className={own.small}>{t('setup.cantScan')}</p>
        <p className={own.key}>
          <code>{view.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
        </p>
        <SetupForm next={typeof next === 'string' ? next : undefined} />
      </div>
    </main>
  );
}
