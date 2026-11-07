import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getTranslations } from 'next-intl/server';
import { getContainer } from '@/adapters/container';
import { createDataReads } from '@/application/data/reads';
import { dataKeys, PAGE_SIZE } from '@/queries/keys';
import { filtersOf, readAddress, writeAddress } from '@/screens/transactions/model';
import { Transactions } from '@/screens/transactions/Transactions';
import styles from '@/screens/transactions/Transactions.module.css';
import { redirectIfStopped } from '../../api/data/respond';
import { requireMoneyAccess } from '../../guarded';

// Transactions (SF-165; AC-6, D-82, D-127): the server reads the first page for the address (month, kind, category,
// sort; free text is never in it) through the read use case, hydrates the island with it, and renders nothing until then.
// One read, counted against the person's limit; past it, the limit page (AC-17); a refused token signs out and opens
// sign-in with this address kept. A failed read is left out, so the list
// asks again in the browser and says so if it fails. The heading comes first and takes focus after a navigation (AC-10).
export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function TransactionsPage({ searchParams }: { searchParams: Search }) {
  const t = await getTranslations();
  // The h1 is the page's first element, with no wrapper: Next.js focuses a new page's first element after a navigation.
  const intro = (
    <>
      <h1 tabIndex={-1} className={styles.heading}>
        {t('nav.transactions')}
      </h1>
      <p className={styles.sub}>{t('transactions.sub')}</p>
    </>
  );
  // The money layout already checked the session; this read only hands the page the person's token.
  const access = await requireMoneyAccess();
  if (!access.ok) return intro;

  const container = getContainer();
  const now = new Date(container.clock.now()).toISOString().slice(0, 7);
  const address = readAddress(await searchParams, now);
  const filters = filtersOf(address);
  const first = await createDataReads(container).listTransactions(access.session, {
    from: address.month,
    to: address.month,
    ...(address.kind ? { kind: address.kind } : {}),
    ...(address.category ? { category: address.category } : {}),
    sort: address.sort,
    order: address.order,
    limit: PAGE_SIZE,
  });
  if (!first.ok) await redirectIfStopped(first, `/transactions?${writeAddress(address)}`);

  const client = new QueryClient();
  if (first.ok) client.setQueryData(dataKeys.transactions(filters), { pages: [first.data], pageParams: [undefined] });
  return (
    <>
      {intro}
      <HydrationBoundary state={dehydrate(client)}>
        <Transactions key={JSON.stringify(address)} address={address} now={now} />
      </HydrationBoundary>
    </>
  );
}
