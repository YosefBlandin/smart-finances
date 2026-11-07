import { getTranslations } from 'next-intl/server';
import { Data } from '@/screens/data/Data';
import styles from '@/screens/data/Data.module.css';
import { eraseData } from './actions';

// Your data (SF-168; AC-7, AC-8): what is stored, the export (GET /api/data/export), erase everything through the
// eraseData server action, and the way to delete the account (/data/delete). The page reads no money data itself, so it
// has no loading state (architecture.md "Screen states"); the money layout has checked the session. The heading comes
// first and takes focus after a navigation (AC-10).
export const dynamic = 'force-dynamic';

export default async function DataPage() {
  const t = await getTranslations();
  return (
    <>
      <h1 tabIndex={-1} className={styles.heading}>
        {t('nav.data')}
      </h1>
      <p className={styles.sub}>{t('data.sub')}</p>
      <Data erase={eraseData} />
    </>
  );
}
