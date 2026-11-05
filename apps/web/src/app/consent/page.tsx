import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getContainer } from '@/adapters/container';
import { createGuard } from '@/application/guard';
import { readSessionCookie } from '../cookies';
import states from '../states.module.css';
import styles from './consent.module.css';
import { Ended } from './Ended';
import { ConsentForm, DeclineForm } from './forms';

// Consent (AC-14, D-87, D-145): a signed-in person with no consent row, or one at an older terms or privacy version,
// lands here from the money layout and accepts the current versions before any money screen opens; refusing signs out.
// A consent at the current versions goes on to the overview; no live session shows the "session ended" screen.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.consent');
  return { title: `${t('title')} · Cuenta` };
}

export default async function ConsentPage() {
  const view = await createGuard(getContainer()).consentView(await readSessionCookie());
  if (view.status === 'current') redirect('/overview');
  if (view.status === 'signed-out') return <Ended why={view.why} />;
  if (view.status === 'deleting') return <Ended />;

  const t = await getTranslations('auth.consent');
  const { terms, privacy } = view.versions;
  return (
    <main className={states.page}>
      <div className={states.card}>
        <p className={states.brand}>cuenta</p>
        <h1 className={states.title} tabIndex={-1}>
          {t('title')}
        </h1>
        <p className={states.lead}>{view.changed ? t('lead') : t('leadFirst')}</p>
        <div className={styles.sections}>
          <section className={styles.section} aria-labelledby="consent-keep">
            <h2 id="consent-keep" className={styles.sectionTitle}>
              {t('keepTitle')}
            </h2>
            <ul className={styles.list}>
              <li>{t('keep1')}</li>
              <li>{t('keep2')}</li>
              <li>{t('keep3')}</li>
            </ul>
          </section>
          <section className={styles.section} aria-labelledby="consent-where">
            <h2 id="consent-where" className={styles.sectionTitle}>
              {t('whereTitle')}
            </h2>
            <p>{t('where')}</p>
          </section>
          <section className={styles.section} aria-labelledby="consent-how-long">
            <h2 id="consent-how-long" className={styles.sectionTitle}>
              {t('howLongTitle')}
            </h2>
            <p>{t('howLong')}</p>
          </section>
          <section className={styles.section} aria-labelledby="consent-remove">
            <h2 id="consent-remove" className={styles.sectionTitle}>
              {t('removeTitle')}
            </h2>
            <p>{t('remove')}</p>
          </section>
          <p className={styles.small}>{t('versions', { terms, privacy })}</p>
        </div>
        <ConsentForm terms={terms} privacy={privacy} />
        <DeclineForm />
      </div>
    </main>
  );
}
