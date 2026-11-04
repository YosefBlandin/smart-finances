import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import styles from '../../states.module.css';
import { ForgotForm } from './forms';
import own from './reset.module.css';

// Reset the password, step 1 (AC-20): the email, behind the proof of work. The reply is the same for any email (the
// code goes out only when there is an account); the action opens /reset/confirm. The lost-authenticator page is linked
// here (D-103): a new password never replaces the authenticator.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.reset');
  return { title: `${t('title')} · Cuenta` };
}

export default async function ResetPage() {
  const t = await getTranslations('auth');
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>cuenta</p>
        <h1 className={styles.title} tabIndex={-1}>
          {t('reset.title')}
        </h1>
        <p className={styles.lead}>{t('reset.lead')}</p>
        <ForgotForm />
        <p className={own.links}>
          <Link href="/sign-in">{t('common.back')}</Link>
          <Link href="/lost-authenticator">{t('code.lost')}</Link>
        </p>
      </div>
    </main>
  );
}
