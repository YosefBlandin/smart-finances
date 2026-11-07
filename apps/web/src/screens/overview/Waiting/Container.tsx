'use client';

import type { TotalsRange } from '@/queries/keys';
import { useImports, useRates, useReview, useTotals } from '@/queries/data';
import { waiting } from '../model';
import { SectionFallback, sectionState } from '../Section';
import { WaitingView } from './View';

/**
 * The waiting line's data: the rows to review and the imports, plus the month's rate from the field's reads. It shows
 * nothing while loading (it is there only when something waits); a failed read shows its note and retry.
 */
export function WaitingContainer({ month, range }: { month: string; range: TotalsRange }) {
  const review = useReview();
  const imports = useImports();
  const totals = useTotals(range);
  const rates = useRates();
  const queries = [review, imports];
  const state = sectionState(queries);
  if (state === 'failed') return <SectionFallback name="waiting" state="failed" queries={queries} />;
  if (!review.data || !imports.data) return null;
  return <WaitingView month={month} waiting={waiting(month, review.data, imports.data, totals.data, rates.data)} />;
}
