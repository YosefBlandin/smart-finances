import { getTranslations } from 'next-intl/server';
import { Note } from '@/ui/primitives/Note/Note';
import styles from '../../states.module.css';

// Sign-in placeholder: PR 3 adds the form and the session. The middleware sends signed-out people here with
// ?next=<path>, and an idle sign-out arrives with ?reason=idle, which shows the notice (30 idle minutes).
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { reason } = await searchParams;
  const t = await getTranslations('auth');
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>cuenta</p>
        <h1 className={styles.title} tabIndex={-1}>
          {t('signIn.title')}
        </h1>
        {reason === 'idle' ? <Note role="status">{t('idle.banner')}</Note> : null}
        <p className={styles.lead}>{t('signIn.lead')}</p>
        <p className={styles.footer}>{t('common.footer')}</p>
      </div>
    </main>
  );
}
