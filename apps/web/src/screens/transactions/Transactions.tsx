'use client';

import { useState } from 'react';
import type { MonthInfo } from '@/ui/patterns/MonthPicker/MonthPicker';
import { FiltersView } from './Filters/View';
import { ListContainer } from './List/Container';
import { addMonths, toggleSort, writeAddress, type Address } from './model';
import styles from './Transactions.module.css';

// The transactions island (AC-6, D-82, D-127): the server prefetched the first page for the address. Every filter, sort
// and page change then asks the data route for that page without a page load; month, view, kind, category and sort are
// kept in the address through the history API, which Next.js keeps in step with its router, so the server is not asked
// to render again. Free text lives only in this component's state and the form.

export type TransactionsProps = { address: Address; now: string };

/** The months the picker offers: three years up to now (and the shown month). */
function pickerMonths(month: string, now: string): MonthInfo[] {
  const last = month > now ? month : now;
  const months = Array.from({ length: 36 }, (_, i) => addMonths(last, -i));
  if (!months.includes(month)) months.push(month);
  return months.map((m) => ({ month: m, hasData: true, hasRate: true }));
}

export function Transactions({ address: first, now }: TransactionsProps) {
  const [address, setAddress] = useState(first);
  const [q, setQ] = useState('');
  const change = (next: Address) => {
    setAddress(next);
    window.history.replaceState(window.history.state, '', `?${writeAddress(next)}`);
  };
  return (
    <div className={styles.screen}>
      <FiltersView address={address} months={pickerMonths(address.month, now)} q={q} onChange={change} onSearch={setQ} />
      <ListContainer address={address} q={q} onSort={(by) => change(toggleSort(address, by))} />
    </div>
  );
}
