import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import styles from '../../states.module.css';
import { SignUpForm } from './forms';
import own from './signUp.module.css';

// Sign up (AC-12, AC-14, AC-19): email, password and the accepted privacy notice and terms (D-145: accepted once, here),
// behind the proof of work. The action answers the confirm screen for any email (D-106). Signed-in people are sent to the
// overview by the middleware (an auth route).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signUp');
  return { title: `${t('title')} · Cuenta` };
}

export default async function SignUpPage() {
  const t = await getTranslations('auth');
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>cuenta</p>
        <h1 className={styles.title} tabIndex={-1}>
          {t('signUp.title')}
        </h1>
        <p className={styles.lead}>{t('signUp.lead')}</p>
        <SignUpForm />
        <p className={own.links}>
          <span>{t('signUp.haveAccount')}</span>
          <Link href="/sign-in">{t('signUp.signInLink')}</Link>
        </p>
      </div>
    </main>
  );
}
