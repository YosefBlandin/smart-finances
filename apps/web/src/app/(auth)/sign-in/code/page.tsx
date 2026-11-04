import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContainer } from '@/adapters/container';
import { createSignIn } from '@/application/auth/signIn';
import { readPreAuthCookie } from '../../../cookies';
import styles from '../../../states.module.css';
import { CodeForm } from '../forms';
import own from '../signIn.module.css';

// The authenticator code of a later sign-in (AC-1). A right code opens a new session and the overview (or the kept
// ?next); a lost authenticator goes to its page (D-103). Without a live code row the person starts again.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.code');
  return { title: `${t('title')} · Cuenta` };
}

export default async function CodePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await createSignIn(getContainer()).codeStep(await readPreAuthCookie()))) redirect('/sign-in');
  const { next } = await searchParams;
  const t = await getTranslations('auth');
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>cuenta</p>
        <h1 className={styles.title} tabIndex={-1}>
          {t('code.title')}
        </h1>
        <p className={styles.lead}>{t('code.lead')}</p>
        <CodeForm next={typeof next === 'string' ? next : undefined} />
        <p className={own.links}>
          <Link href="/lost-authenticator">{t('code.lost')}</Link>
        </p>
      </div>
    </main>
  );
}
