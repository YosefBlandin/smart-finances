'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRates, useTotals } from '@/queries/data';
import type { TotalsRange } from '@/queries/keys';
import { MonthPicker, type MonthInfo } from '@/ui/patterns/MonthPicker/MonthPicker';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import { KeptContainer } from './Kept/Container';
import { PlacesContainer } from './Places/Container';
import { TimeContainer } from './Time/Container';
import { WaitingContainer } from './Waiting/Container';
import { WhereContainer } from './Where/Container';
import styles from './Overview.module.css';

// The overview island (D-18, D-127): one column read top to bottom, under a toolbar with the month picker. The server
// page prefetched every section's reads and hydrated them, so the first view asks for nothing. Picking a month changes
// it here and keeps the address in sync without a server render (the totals already cover three years, so only the
// places read is new); each section shows its own skeleton or failed note (D-101, D-128). Net worth is not shown (D-18).

export type OverviewProps = { month: string; range: TotalsRange };

export function Overview({ month: first, range }: OverviewProps) {
  const t = useTranslations();
  const [month, setMonth] = useState(first);
  const totals = useTotals(range);
  const rates = useRates();

  const choose = (next: string) => {
    setMonth(next);
    const search = new URLSearchParams(window.location.search);
    search.set('month', next);
    // Next.js keeps useSearchParams in step with the history API, and nothing is asked of the server (D-127).
    window.history.replaceState(window.history.state, '', `?${search}`);
  };

  if (totals.data && totals.data.months.length === 0) {
    return (
      <StateBlock
        kind="empty"
        title={t('states.empty.dashboard.title')}
        text={t('states.empty.dashboard.text')}
        action={
          <Link href="/imports" className={styles.go}>
            {t('states.empty.dashboard.action')}
          </Link>
        }
      />
    );
  }

  const rated = new Set(rates.data?.items.map((r) => r.month));
  const months: MonthInfo[] = (totals.data?.months ?? []).map((m) => ({ month: m.month, hasData: true, hasRate: rated.has(m.month) }));
  if (!months.some((m) => m.month === month)) months.push({ month, hasData: true, hasRate: rated.has(month) });

  return (
    <div className={styles.column}>
      <div className={styles.toolbar}>
        <MonthPicker months={months} value={month} onChange={choose} />
      </div>
      <KeptContainer month={month} range={range} />
      <WaitingContainer month={month} range={range} />
      <WhereContainer month={month} range={range} />
      <TimeContainer month={month} range={range} />
      <PlacesContainer month={month} />
    </div>
  );
}
