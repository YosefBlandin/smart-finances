'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransactions } from '@/queries/data';
import { dataKeys, PAGE_SIZE } from '@/queries/keys';
import { LABEL_TOTALS_AGAIN_MS } from '../../review/Review';
import type { LabelResult, RecipientLabel } from '../../label/LabelForm';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import { filtersOf, type Address } from '../model';
import { ListView } from './View';

/**
 * The list's data: useTransactions for the address and the free text, page by page (AC-6). A skeleton while a new page
 * loads (D-128); nothing matching or a failed read says so with the next step (AC-8). A recipient label waits for the
 * server's answer here (D-131 keeps optimism to the review screen); once saved, the list, the review rows and the totals
 * are asked again, and the totals once more after the API's rebuild has had time (mercadopago-enrichment D-13).
 */
export function ListContainer({
  address,
  q,
  onSort,
  label,
}: {
  address: Address;
  q: string;
  onSort: (by: Address['sort']) => void;
  label?: (label: RecipientLabel) => Promise<LabelResult>;
}) {
  const t = useTranslations();
  const client = useQueryClient();
  const router = useRouter();
  const query = useTransactions(filtersOf(address, q));
  const onLabel = label
    ? async (saved: RecipientLabel): Promise<LabelResult> => {
        const result = await label(saved);
        if (result.ok) {
          void client.invalidateQueries({ queryKey: [...dataKeys.all, 'transactions'] });
          void client.invalidateQueries({ queryKey: dataKeys.review() });
          void client.invalidateQueries({ queryKey: [...dataKeys.all, 'totals'] });
          setTimeout(() => void client.invalidateQueries({ queryKey: [...dataKeys.all, 'totals'] }), LABEL_TOTALS_AGAIN_MS);
          router.refresh();
        }
        return result;
      }
    : undefined;
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
      onLabel={onLabel}
    />
  );
}
