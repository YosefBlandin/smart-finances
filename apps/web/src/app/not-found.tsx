import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import styles from './states.module.css';

// The one not-found screen (AC-8, D-101). Anything a person cannot open answers with it: a missing page, and from PR 3
// on a resource that belongs to someone else (the guard calls notFound()), so "not yours" and "not there" look the same
// (AC-15). The overview link sends a signed-out person to sign-in through the middleware.
export default async function NotFound() {
  const t = await getTranslations('auth.notFound');
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.label}>{t('label')}</p>
        <h1 className={styles.title} tabIndex={-1}>
          {t('title')}
        </h1>
        <p className={styles.lead}>{t('lead')}</p>
        <div className={styles.actions}>
          <Link className={styles.go} href="/overview">
            {t('go')}
          </Link>
        </div>
      </div>
    </main>
  );
}
