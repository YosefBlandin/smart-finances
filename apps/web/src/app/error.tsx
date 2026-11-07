'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/ui/primitives/Button/Button';
import styles from './states.module.css';

// A screen that failed to load (AC-8, D-101): the plain failed message and a retry, never a blank page. The error itself
// is not shown; it may carry server details.
export default function ErrorScreen({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('states');
  return (
    <main className={styles.page}>
      <div className={styles.card} role="alert">
        <h1 className={styles.title} tabIndex={-1}>
          {t('errT')}
        </h1>
        <p className={styles.lead}>{t('errB')}</p>
        <div className={styles.actions}>
          <Button variant="primary" icon="retry" onClick={() => reset()}>
            {t('retry')}
          </Button>
        </div>
      </div>
    </main>
  );
}
