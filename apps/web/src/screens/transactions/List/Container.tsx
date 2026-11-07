'use client';

import { useTranslations } from 'next-intl';
import { useTransactions } from '@/queries/data';
import { PAGE_SIZE } from '@/queries/keys';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import { filtersOf, type Address } from '../model';
import { ListView } from './View';

/**
 * The list's data: useTransactions for the address and the free text, page by page (AC-6). A skeleton while a new page
 * loads (D-128); nothing matching or a failed read says so with the next step (AC-8).
 */
export function ListContainer({ address, q, onSort }: { address: Address; q: string; onSort: (by: Address['sort']) => void }) {
  const t = useTranslations();
  const query = useTransactions(filtersOf(address, q));
  if (!query.data) {
    if (query.error && !query.isFetching) {
      return <StateBlock kind="error" title={t('states.errT')} text={t('states.errB')} onRetry={() => void query.refetch()} />;
    }
    return <StateBlock kind="loading" lines={6} />;
  }
  const rows = query.data.pages.flatMap((p) => p.items);
  if (rows.length === 0) return <StateBlock kind="empty" title={t('states.empty.transactions.title')} text={t('states.empty.transactions.text')} />;
  return (
    <ListView
      rows={rows}
      address={address}
      pageSize={PAGE_SIZE}
      hasNext={Boolean(query.hasNextPage)}
      loadingNext={query.isFetchingNextPage}
      onSort={onSort}
      onNext={() => void query.fetchNextPage()}
    />
  );
}
