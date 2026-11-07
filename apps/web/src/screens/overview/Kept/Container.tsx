'use client';

import type { TotalsRange } from '@/queries/keys';
import { useRates, useTotals } from '@/queries/data';
import { keptFigures } from '../model';
import { SectionFallback, sectionState } from '../Section';
import { KeptView } from './View';

/** The colour field's data: the month totals (three years in one read) and the dollar rates. */
export function KeptContainer({ month, range }: { month: string; range: TotalsRange }) {
  const totals = useTotals(range);
  const rates = useRates();
  const queries = [totals, rates];
  const state = sectionState(queries);
  if (state !== 'ready' || !totals.data || !rates.data)
    return <SectionFallback name="kept" state={state === 'ready' ? 'loading' : state} queries={queries} />;
  return <KeptView month={month} figures={keptFigures(month, totals.data, rates.data)} />;
}
