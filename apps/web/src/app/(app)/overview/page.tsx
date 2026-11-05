import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getTranslations } from 'next-intl/server';
import { getContainer } from '@/adapters/container';
import { createDataReads } from '@/application/data/reads';
import { dataKeys } from '@/queries/keys';
import { MONTH, monthOf, placesFilters, shownMonth, totalsRange } from '@/screens/overview/model';
import { Overview } from '@/screens/overview/Overview';
import styles from '@/screens/overview/Overview.module.css';
import { redirectIfLimited } from '../../api/data/respond';
import { requireMoneyAccess } from '../../guarded';

// The overview (SF-164; D-18, D-101, D-127): the server reads every section's data through the read use cases (each
// read times out at 5 seconds and counts against the person's limit, D-82), hydrates the island with it, and renders
// nothing until then (no streaming). Five reads: totals for three years, the rates, the rows to review, the imports and
// the month's biggest expenses (places). A read past the limit goes to the limit page (AC-17); any other failed read is
// left out, so that section asks again in the browser and shows its own failed note (D-101). The heading comes first
// and takes focus after a navigation (AC-10).
export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function OverviewPage({ searchParams }: { searchParams: Search }) {
  const t = await getTranslations();
  const heading = (
    <h1 tabIndex={-1} className={styles.srOnly}>
      {t('nav.dashboard')}
    </h1>
  );
  // The money layout already checked the session; this read only hands the page the person's token.
  const access = await requireMoneyAccess();
  if (!access.ok) return heading;

  const value = (await searchParams).month;
  const asked = typeof value === 'string' && MONTH.test(value) ? value : undefined;
  const container = getContainer();
  const reads = createDataReads(container);
  const who = access.session;
  const now = monthOf(container.clock.now());
  const range = totalsRange(asked, now);
  const placesOf = (month: string) => {
    const f = placesFilters(month);
    return reads.listTransactions(who, { from: month, to: month, kind: 'expense', sort: f.sort, order: f.order, limit: f.limit });
  };

  // With a month in the address every read starts at once; without one, the month is the latest with data, so places
  // waits for the totals.
  const early = asked ? placesOf(asked) : undefined;
  const [totals, rates, review, imports] = await Promise.all([
    reads.getTotals(who, range),
    reads.getRates(who),
    reads.getReview(who),
    reads.listImports(who, {}),
  ]);
  const month = shownMonth(asked, totals.ok ? totals.data : undefined, now);
  const places = await (early ?? placesOf(month));
  for (const result of [totals, rates, review, imports, places]) if (!result.ok) redirectIfLimited(result);

  const client = new QueryClient();
  if (totals.ok) client.setQueryData(dataKeys.totals(range), totals.data);
  if (rates.ok) client.setQueryData(dataKeys.rates(), rates.data);
  if (review.ok) client.setQueryData(dataKeys.review(), review.data);
  if (imports.ok) client.setQueryData(dataKeys.imports(), imports.data);
  if (places.ok) client.setQueryData(dataKeys.transactions(placesFilters(month)), { pages: [places.data], pageParams: [undefined] });

  return (
    <>
      {heading}
      <HydrationBoundary state={dehydrate(client)}>
        <Overview key={month} month={month} range={range} />
      </HydrationBoundary>
    </>
  );
}
