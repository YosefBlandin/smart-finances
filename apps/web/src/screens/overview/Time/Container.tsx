'use client';

import type { TotalsRange } from '@/queries/keys';
import { useRates, useTotals } from '@/queries/data';
import { overTime } from '../model';
import { SectionFallback, sectionState } from '../Section';
import { TimeView } from './View';

/** Over time: the kept share of the shown month and the 11 before it, from the same totals and rates. */
export function TimeContainer({ month, range }: { month: string; range: TotalsRange }) {
  const totals = useTotals(range);
  const rates = useRates();
  const queries = [totals, rates];
  const state = sectionState(queries);
  if (state !== 'ready' || !totals.data || !rates.data)
    return <SectionFallback name="time" state={state === 'ready' ? 'loading' : state} queries={queries} />;
  return <TimeView figures={overTime(month, totals.data, rates.data)} />;
}
