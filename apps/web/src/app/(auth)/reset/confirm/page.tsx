import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContainer } from '@/adapters/container';
import { createReset } from '@/application/auth/reset';
import { readPreAuthCookie } from '../../../cookies';
import styles from '../../../states.module.css';
import { ResetConfirmForm, ResetResendForm } from '../forms';
import own from '../reset.module.css';

// Reset the password, step 2 (AC-20, D-92): the code from the email and the new password. The pre-auth row (__Host-pre,
// step reset) names the email; without it the person starts again at /reset. The sign-in after it still asks for the
// authenticator code, and the lost-authenticator page is linked here (D-103).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.resetConfirm');
  return { title: `${t('title')} · Cuenta` };
}

export default async function ResetConfirmPage() {
  const row = await createReset(getContainer()).step(await readPreAuthCookie());
  if (!row) redirect('/reset');
  const t = await getTranslations('auth');
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>cuenta</p>
        <h1 className={styles.title} tabIndex={-1}>
          {t('resetConfirm.title')}
        </h1>
        <p className={styles.lead}>{t('reset.sentLead', { email: row.email })}</p>
        <p className={own.small}>{t('resetConfirm.lead')}</p>
        <ResetConfirmForm />
        <ResetResendForm />
        <p className={own.small}>{t('confirm.spam')}</p>
        <p className={own.links}>
          <Link href="/reset">{t('confirm.wrongAddress')}</Link>
          <Link href="/lost-authenticator">{t('code.lost')}</Link>
          <Link href="/sign-in">{t('common.back')}</Link>
        </p>
      </div>
    </main>
  );
}
