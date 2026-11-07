'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import styles from './Overview.module.css';

// One overview section's frame and its own states (AC-8, D-101, D-128): each section shows a skeleton while its data
// loads (only after a month change; the first view is prefetched) and, when a read failed, its own note with a retry,
// so the other sections stay.

export type SectionName = 'kept' | 'waiting' | 'where' | 'time' | 'places';
type Query = { data?: unknown; error: unknown; isFetching: boolean; refetch: () => unknown };
export type SectionState = 'ready' | 'loading' | 'failed';

/** ready when every read has data; failed when one ended without data; loading otherwise. */
export function sectionState(queries: Query[]): SectionState {
  if (queries.every((q) => q.data !== undefined)) return 'ready';
  if (queries.some((q) => q.data === undefined && q.error && !q.isFetching)) return 'failed';
  return 'loading';
}

export function Section({ name, labelledBy, children }: { name: SectionName; labelledBy?: string; children: ReactNode }) {
  return (
    <section data-section={name} className={styles.section} aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}

/** The section's place while it loads or after it failed; Try again asks again for what is missing. */
export function SectionFallback({ name, state, queries }: { name: SectionName; state: Exclude<SectionState, 'ready'>; queries: Query[] }) {
  const t = useTranslations();
  return (
    <Section name={name}>
      {state === 'loading' ? (
        <StateBlock kind="loading" />
      ) : (
        <StateBlock
          kind="error"
          title={t('overview.sectionFailed')}
          text={t('states.errB')}
          onRetry={() => {
            for (const q of queries) if (q.data === undefined) void q.refetch();
          }}
        />
      )}
    </Section>
  );
}
