'use client';

import { useTransactions } from '@/queries/data';
import { places, placesFilters } from '../model';
import { SectionFallback, sectionState } from '../Section';
import { PlacesView } from './View';

/** Places: the month's biggest expenses, one page of 200, summed by place. */
export function PlacesContainer({ month }: { month: string }) {
  const query = useTransactions(placesFilters(month));
  const queries = [query];
  const state = sectionState(queries);
  if (state !== 'ready' || !query.data) return <SectionFallback name="places" state={state === 'ready' ? 'loading' : state} queries={queries} />;
  return <PlacesView places={places(query.data.pages.flatMap((p) => p.items))} />;
}
