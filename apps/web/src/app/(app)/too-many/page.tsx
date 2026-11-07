import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import styles from './too-many.module.css';

// The person limit page (SF-172; AC-17, D-120): a money page whose read went past the person's data requests a minute
// lands here from redirectIfLimited (app/api/data/respond.ts) with the wait in seconds from the counter. It reads no
// data itself, says how long to wait in plain words, and offers the overview for afterwards. Another person is not
// slowed: the counter is per person. A wait that is missing or not a whole number of seconds up to an hour reads as 60.
export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

/** The wait from the address: whole seconds, 1 to 3600; anything else is a minute. */
function waitSeconds(value: string | string[] | undefined): number {
  const n = typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : NaN;
  return n >= 1 && n <= 3600 ? n : 60;
}

export default async function TooManyPage({ searchParams }: { searchParams: Search }) {
  const t = await getTranslations('limit');
  const seconds = waitSeconds((await searchParams).wait);
  return (
    <div className={styles.screen}>
      <p className={styles.label}>{t('label')}</p>
      <h1 tabIndex={-1} className={styles.heading}>
        {t('title')}
      </h1>
      <p className={styles.lead}>{t('lead', { seconds })}</p>
      <p className={styles.why}>{t('why')}</p>
      <Link className={styles.go} href="/overview">
        {t('back')}
      </Link>
    </div>
  );
}
