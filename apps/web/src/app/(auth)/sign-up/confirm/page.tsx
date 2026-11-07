import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContainer } from '@/adapters/container';
import { createSessions } from '@/application/session';
import { readPreAuthCookie } from '../../../cookies';
import styles from '../../../states.module.css';
import { ConfirmForm, ResendForm } from '../forms';
import own from '../signUp.module.css';

// Confirm the email (AC-12, D-147): the code from the sign-up email creates the account. The pre-auth row (__Host-pre)
// names the email; without a row in the confirm step the person starts again at /sign-up. No code lifetime is stated; a
// failed code offers "Send a new code".
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.confirm');
  return { title: `${t('title')} · Cuenta` };
}

export default async function ConfirmPage() {
  const row = await createSessions(getContainer()).readPreAuth(await readPreAuthCookie());
  if (row?.step !== 'confirm') redirect('/sign-up');
  const t = await getTranslations('auth');
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>cuenta</p>
        <h1 className={styles.title} tabIndex={-1}>
          {t('confirm.title')}
        </h1>
        <p className={styles.lead}>{t('confirm.lead', { email: row.email })}</p>
        <ConfirmForm />
        <ResendForm />
        <p className={own.small}>{t('confirm.spam')}</p>
        <p className={own.links}>
          <Link href="/sign-up">{t('confirm.wrongAddress')}</Link>
        </p>
      </div>
    </main>
  );
}
