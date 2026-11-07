// @vitest-environment jsdom
import { HydrationBoundary, useQuery, useQueryClient } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefetch } from './prefetch';
import { QueryProvider, STALE_TIME_MS } from './provider';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function Totals({ fetcher }: { fetcher: () => Promise<{ kept: number }> }) {
  const q = useQuery({ queryKey: ['totals', '2026-05'], queryFn: fetcher });
  return <p>{q.data ? `kept ${q.data.kept}` : 'loading'}</p>;
}

describe('T-WEB-16: server prefetch and client hydration', () => {
  it('T-WEB-16: prefetch() returns a dehydrated state holding the fetched data', async () => {
    const state = await prefetch(['totals', '2026-05'], async () => ({ kept: 120 }));
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]?.queryKey).toEqual(['totals', '2026-05']);
    expect(state.queries[0]?.state.data).toEqual({ kept: 120 });
  });

  it('T-WEB-16: the client provider reads the hydrated query without a request', async () => {
    const state = await prefetch(['totals', '2026-05'], async () => ({ kept: 120 }));
    const browserFetch = vi.fn(async () => ({ kept: 999 }));
    render(
      <QueryProvider>
        <HydrationBoundary state={state}>
          <Totals fetcher={browserFetch} />
        </HydrationBoundary>
      </QueryProvider>,
    );
    expect(screen.getByText('kept 120')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(browserFetch).not.toHaveBeenCalled();
    expect(screen.getByText('kept 120')).toBeTruthy();
  });

  it('T-WEB-16: without a prefetch the client does request', async () => {
    const browserFetch = vi.fn(async () => ({ kept: 7 }));
    render(
      <QueryProvider>
        <Totals fetcher={browserFetch} />
      </QueryProvider>,
    );
    expect(await screen.findByText('kept 7')).toBeTruthy();
    expect(browserFetch).toHaveBeenCalledTimes(1);
  });

  it('T-WEB-16: the provider keeps data fresh for 30 seconds', () => {
    expect(STALE_TIME_MS).toBe(30_000);
    let staleTime: unknown;
    function Probe() {
      staleTime = useQueryClient().getDefaultOptions().queries?.staleTime;
      return null;
    }
    render(
      <QueryProvider>
        <Probe />
      </QueryProvider>,
    );
    expect(staleTime).toBe(30_000);
  });

  it("T-WEB-16: prefetch uses a fresh client per call, so one request never sees another person's data", async () => {
    const a = await prefetch(['totals', '2026-05'], async () => ({ kept: 1 }));
    const b = await prefetch(['rates'], async () => ({ items: [] }));
    expect(a.queries.map((q) => q.queryKey)).toEqual([['totals', '2026-05']]);
    expect(b.queries.map((q) => q.queryKey)).toEqual([['rates']]);
  });

  it('T-WEB-16: a failed prefetch is not dehydrated, so the client retries in the browser', async () => {
    const state = await prefetch(['totals', '2026-05'], async () => {
      throw new Error('down');
    });
    expect(state.queries).toHaveLength(0);
  });

  it('T-WEB-16: devtools only in development', async () => {
    const { container } = render(
      <QueryProvider>
        <span>child</span>
      </QueryProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.querySelector('.tsqd-parent-container')).toBeNull();
    cleanup();

    // jsdom has no matchMedia; the devtools panel reads it for its colour scheme.
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const dev = await import('./provider');
    render(
      <dev.QueryProvider>
        <span>child</span>
      </dev.QueryProvider>,
    );
    expect(await screen.findByLabelText(/open tanstack query devtools/i, {}, { timeout: 5000 })).toBeTruthy();
  });
});
