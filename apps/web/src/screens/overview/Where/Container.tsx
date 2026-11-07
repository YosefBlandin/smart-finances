'use client';

import type { TotalsRange } from '@/queries/keys';
import { useRates, useTotals } from '@/queries/data';
import { categories } from '../model';
import { SectionFallback, sectionState } from '../Section';
import { WhereView } from './View';

/** Where it went: the month's totals by category, dollars in pesos at the month's rate. */
export function WhereContainer({ month, range }: { month: string; range: TotalsRange }) {
  const totals = useTotals(range);
  const rates = useRates();
  const queries = [totals, rates];
  const state = sectionState(queries);
  if (state !== 'ready' || !totals.data || !rates.data)
    return <SectionFallback name="where" state={state === 'ready' ? 'loading' : state} queries={queries} />;
  return <WhereView figures={categories(month, totals.data, rates.data)} />;
}
