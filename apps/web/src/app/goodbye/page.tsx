import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getContainer } from '@/adapters/container';
import { createDeleteAccount } from '@/application/account/deleteAccount';
import { GOODBYE } from '@/domain/deletion';
import { Note } from '@/ui/primitives/Note/Note';
import states from '../states.module.css';
import styles from './goodbye.module.css';

// After deleting the account (SF-169; AC-18, D-104): a public page, since the person has no session left. It shows what
// the 5-minute goodbye cookie holds, which the finish action signed with the stage's HMAC secret: the counts erased and
// whether every step finished (or the account is closed and the hourly job finishes the rest). Without a valid cookie
// (missing, changed or older than 5 minutes) it says the page has expired; nothing else about the person is known here.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.delete');
  return { title: `${t('doneTitle')} · Cuenta` };
}

export default async function GoodbyePage() {
  const t = await getTranslations('auth.delete');
  const value = (await cookies()).get(GOODBYE.cookie)?.value;
  const goodbye = await createDeleteAccount(getContainer()).readGoodbye(value);
  const start = (
    <div className={states.actions}>
      <Link href="/sign-in" className={states.go}>
        {t('start')}
      </Link>
    </div>
  );

  if (!goodbye) {
    return (
      <main className={states.page}>
        <div className={states.card}>
          <p className={states.brand}>cuenta</p>
          <h1 className={states.title} tabIndex={-1}>
            {t('goneTitle')}
          </h1>
          <p className={states.lead}>{t('doneNote')}</p>
          {start}
        </div>
      </main>
    );
  }

  const done = goodbye.closed === 'done';
  return (
    <main className={states.page}>
      <div className={states.card}>
        <p className={states.brand}>cuenta</p>
        <h1 className={states.title} tabIndex={-1}>
          {done ? t('doneTitle') : t('partialTitle')}
        </h1>
        {done ? (
          <p className={states.lead}>{t('doneLead')}</p>
        ) : (
          <Note tone="error" role="status">
            {t('partialClosedLead')}
          </Note>
        )}
        {goodbye.erased ? (
          <>
            {done ? null : <p className={styles.label}>{t('erasedSoFar')}</p>}
            <dl className={styles.counts}>
              <div>
                <dt>{t('items')}</dt>
                <dd>{goodbye.erased.items}</dd>
              </div>
              <div>
                <dt>{t('files')}</dt>
                <dd>{goodbye.erased.files}</dd>
              </div>
            </dl>
          </>
        ) : null}
        <p className={styles.small}>{t('doneBackups')}</p>
        <p className={styles.small}>{t('doneNote')}</p>
        {start}
      </div>
    </main>
  );
}
