import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getTranslations } from 'next-intl/server';
import { getContainer } from '@/adapters/container';
import { createDataReads } from '@/application/data/reads';
import { dataKeys } from '@/queries/keys';
import { Imports } from '@/screens/imports/Imports';
import styles from '@/screens/imports/Imports.module.css';
import { redirectIfStopped } from '../../api/data/respond';
import { requireMoneyAccess } from '../../guarded';
import { requestImport } from './actions';

// Imports (SF-167; AC-5, AC-17, D-114): the server reads the person's imports and hydrates the island with them; past
// the person limit, the limit page. A failed read is left out, so the island asks again and says so if it fails. A file
// is requested through the requestImport server action and sent from the browser to the presigned form. The heading
// comes first and takes focus after a navigation (AC-10).
export const dynamic = 'force-dynamic';

export default async function ImportsPage() {
  const t = await getTranslations();
  const intro = (
    <>
      <h1 tabIndex={-1} className={styles.heading}>
        {t('nav.imports')}
      </h1>
      <p className={styles.sub}>{t('imports.sub')}</p>
    </>
  );
  // The money layout already checked the session; this read only hands the page the person's token.
  const access = await requireMoneyAccess();
  if (!access.ok) return intro;

  const imports = await createDataReads(getContainer()).listImports(access.session, {});
  if (!imports.ok) await redirectIfStopped(imports, '/imports');
  const client = new QueryClient();
  if (imports.ok) client.setQueryData(dataKeys.imports(), imports.data);
  return (
    <>
      {intro}
      <HydrationBoundary state={dehydrate(client)}>
        <Imports request={requestImport} />
      </HydrationBoundary>
    </>
  );
}
