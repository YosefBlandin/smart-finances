// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
import { IMPORT_POLL } from '@/queries/data';
import { ImportDetail } from './Detail';

// T-WSCR-9 (AC-5; architecture "States and exits", import: "still running after 15 minutes: say it continues"): the
// screen polls an import at most IMPORT_POLL.maxPolls times (under 10 minutes); once it stops while the import still
// runs, it says the import continues without the page and the person can check back later. Synthetic import only.

const RUNNING = {
  import_id: 'imp-slow',
  kind: 'file',
  source: 'mercadopago',
  file_name: 'release-report-2026-10.csv',
  period: '2026-10',
  status: 'importing',
  created_at: '2026-11-06T12:00:00Z',
  active: false,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openSlowImport(locale: 'en' | 'es') {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  let reads = 0;
  vi.stubGlobal('fetch', async () => {
    reads += 1;
    return Response.json(RUNNING);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="UTC">
        <ImportDetail id="imp-slow" listed={undefined} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { reads: () => reads };
}

describe('T-WSCR-9: an import still running when the polling stops says it continues', () => {
  it.each([
    ['en', en.imports.reading, /keeps going without this page.*check back/i],
    ['es', es.imports.reading, /sigue aunque cierres esta página.*vuelve/i],
  ] as const)('T-WSCR-9: %s: reading while polled, then it continues and the person can check back', async (locale, reading, continues) => {
    const s = await openSlowImport(locale);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText(reading)).toBeTruthy();
    // Past every poll (3 s doubling to 30 s, IMPORT_POLL.maxPolls reads, under 10 minutes).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(s.reads()).toBe(IMPORT_POLL.maxPolls);
    expect(screen.queryByText(reading)).toBeNull();
    expect(screen.getByText(continues)).toBeTruthy();
    // The cap holds: no more reads after it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(s.reads()).toBe(IMPORT_POLL.maxPolls);
  });
});
