import { getTranslations } from 'next-intl/server';
import { requireMoneyAccess } from '../../../guarded';
import { finishDeletion, startDeletion } from './actions';
import { DeleteForm } from './DeleteForm';
import styles from './delete.module.css';

// Delete the account (SF-169; AC-18, D-104): its own warning (data, sign-in and sessions removed; backups kept 35 days),
// then a full re-sign-in and the typed word DELETE. The money layout has checked the session; this only reads the
// signed-in address to fill in the email. The page reads no money data. The heading comes first and takes focus after
// a navigation (AC-10).
export const dynamic = 'force-dynamic';

export default async function DeletePage() {
  const t = await getTranslations('auth.delete');
  const access = await requireMoneyAccess();
  return (
    <>
      <h1 tabIndex={-1} className={styles.heading}>
        {t('warnTitle')}
      </h1>
      <p className={styles.sub}>{t('warnLead')}</p>
      <DeleteForm email={access.ok ? access.session.email : ''} start={startDeletion} finish={finishDeletion} />
    </>
  );
}
