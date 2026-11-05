import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import styles from '../privacy/_legal/legal.module.css';
import { publicStage } from '../privacy/_legal/stage';

// Lost authenticator (D-103, D-115, D-148): no self-service reset. The person writes to the stage's support address from
// the account email; the owner asks details only they know, waits 72 hours, resets and signs out everywhere
// (docs/runbooks/lost-authenticator.md). No reply time is promised. Signed-in people are sent to the overview by the
// middleware (an auth route).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.lost');
  return { title: `${t('title')} · Cuenta` };
}

export default async function LostAuthenticatorPage() {
  const t = await getTranslations('auth');
  const { supportAddress } = publicStage();
  return (
    <main className={styles.page}>
      <article className={styles.card}>
        <header className={styles.header}>
          <p className={styles.brand}>cuenta</p>
          <h1 className={styles.title} tabIndex={-1}>
            {t('lost.title')}
          </h1>
          <p className={styles.lead}>{t('lost.lead')}</p>
        </header>
        <ol className={styles.list}>
          <li>{t('lost.step1', { contact: supportAddress })}</li>
          <li>{t('lost.step2')}</li>
          <li>{t('lost.step3')}</li>
        </ol>
        <p>{t('lost.proof')}</p>
        <p>{t('lost.wait')}</p>
        <p className={styles.note}>{t('lost.after')}</p>
        <nav className={styles.links}>
          <Link href="/sign-in">{t('common.back')}</Link>
        </nav>
      </article>
    </main>
  );
}
