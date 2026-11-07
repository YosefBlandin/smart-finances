'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRates, useTotals } from '@/queries/data';
import { dataKeys, type RatesReply, type TotalsRange } from '@/queries/keys';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import { rateRows, undoRate, withRate } from './model';
import { RatesView } from './View';

// The rates island (SF-166; D-131): the server prefetched the rates and the months with data. A rate shows as saved at
// once, then the server action saves it; a refusal puts that month's rate back as it was (any other rate in flight
// stays shown) and says so in plain words. Once the last rate in flight settles, the rates are asked again and the
// totals are marked stale (a rate changes their dollar view, not the months listed here, so they are asked again where
// they are shown next).

export type SaveResult = { ok: true } | { ok: false; messageKey: string };
export type RatesProps = { range: TotalsRange; save: (input: { month: string; arsPerUsd: number }) => Promise<SaveResult> };

const MUTATION = ['rate'] as const;

export function Rates({ range, save }: RatesProps) {
  const t = useTranslations();
  const client = useQueryClient();
  const rates = useRates();
  const totals = useTotals(range);
  const [failed, setFailed] = useState(false);
  const mutation = useMutation({
    mutationKey: MUTATION,
    mutationFn: async ({ month, rate }: { month: string; rate: number }) => {
      const result = await save({ month, arsPerUsd: rate });
      if (!result.ok) throw new Error(result.messageKey);
    },
    onMutate: async ({ month, rate }) => {
      setFailed(false);
      await client.cancelQueries({ queryKey: dataKeys.rates() });
      const before = client.getQueryData<RatesReply>(dataKeys.rates());
      if (before) client.setQueryData<RatesReply>(dataKeys.rates(), withRate(before, month, rate));
      return { before };
    },
    onError: (_error, { month }, context) => {
      // Only this month's rate comes back; another rate still in flight stays shown.
      const before = context?.before;
      if (before) client.setQueryData<RatesReply>(dataKeys.rates(), (shown) => (shown ? undoRate(shown, before, month) : before));
      setFailed(true);
    },
    onSettled: () => {
      if (client.isMutating({ mutationKey: MUTATION }) > 1) return;
      void client.invalidateQueries({ queryKey: dataKeys.rates() });
      void client.invalidateQueries({ queryKey: [...dataKeys.all, 'totals'], refetchType: 'none' });
    },
  });

  if (!rates.data || !totals.data) {
    const error = (rates.error && !rates.isFetching && !rates.data) || (totals.error && !totals.isFetching && !totals.data);
    if (error) {
      return (
        <StateBlock
          kind="error"
          title={t('states.errT')}
          text={t('states.errB')}
          onRetry={() => {
            if (!rates.data) void rates.refetch();
            if (!totals.data) void totals.refetch();
          }}
        />
      );
    }
    return <StateBlock kind="loading" lines={6} />;
  }
  const rows = rateRows(totals.data, rates.data);
  if (rows.length === 0) return <StateBlock kind="empty" title={t('states.empty.rates.title')} text={t('states.empty.rates.text')} />;
  return <RatesView rows={rows} failed={failed} onSave={(month, rate) => mutation.mutate({ month, rate })} />;
}
