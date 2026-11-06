import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getTranslations } from 'next-intl/server';
import { getContainer } from '@/adapters/container';
import { createDataReads } from '@/application/data/reads';
import { dataKeys } from '@/queries/keys';
import { monthOf, totalsRange } from '@/screens/overview/model';
import { Rates } from '@/screens/rates/Rates';
import styles from '@/screens/rates/Rates.module.css';
import { redirectIfLimited } from '../../api/data/respond';
import { requireMoneyAccess } from '../../guarded';
import { saveRate } from './actions';

// Dollar rates (SF-166; AC-8, D-131): the server reads the rates and the month totals of the last three years (the
// months with data, under the overview's key, so either screen's read serves the other) and hydrates the island; past
// the person limit, the limit page (AC-17). A failed read is left out, so the island asks again and says so if it
// fails. Rates go through the saveRate server action. The heading comes first and takes focus after a navigation (AC-10).
export const dynamic = 'force-dynamic';

export default async function RatesPage() {
  const t = await getTranslations();
  const intro = (
    <>
      <h1 tabIndex={-1} className={styles.heading}>
        {t('rates.ratesTitle')}
      </h1>
      <p className={styles.sub}>{t('rates.sub')}</p>
    </>
  );
  // The money layout already checked the session; this read only hands the page the person's token.
  const access = await requireMoneyAccess();
  if (!access.ok) return intro;

  const container = getContainer();
  const reads = createDataReads(container);
  const range = totalsRange(undefined, monthOf(container.clock.now()));
  const [rates, totals] = await Promise.all([reads.getRates(access.session), reads.getTotals(access.session, range)]);
  for (const result of [rates, totals]) if (!result.ok) redirectIfLimited(result);
  const client = new QueryClient();
  if (rates.ok) client.setQueryData(dataKeys.rates(), rates.data);
  if (totals.ok) client.setQueryData(dataKeys.totals(range), totals.data);
  return (
    <>
      {intro}
      <HydrationBoundary state={dehydrate(client)}>
        <Rates range={range} save={saveRate} />
      </HydrationBoundary>
    </>
  );
}
