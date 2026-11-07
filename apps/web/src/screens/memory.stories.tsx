/* eslint-disable import/no-restricted-paths -- Storybook renders the screens on the in-memory adapters (D-129, D-138);
   no production screen imports an adapter. */
import type { Meta, StoryObj } from '@storybook/nextjs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryClock } from '@/adapters/memory/clock';
import { fixtureSeed, MemoryDataApi } from '@/adapters/memory/data-api';
import type { DataApiResult } from '@/ports/data-api';
import { expect, waitFor } from 'storybook/test';
import { DataTable } from '@/ui/patterns/DataTable/DataTable';

// The screen stories' data (SF-171, D-129): each story reads the synthetic fixtures (apps/web/fixtures, the hostile rows
// included) through the memory data API, the adapter the STAGE=test server uses, and hands them to the screen the way
// the money pages do: a query cache filled under the hooks' own keys (the server prefetch), so the first view asks for
// nothing. What the screen asks for after that answers as the story says: never (loading), or a 409 (failed: a refusal
// the hooks show at once, where a 5xx would be retried twice first).
// The helpers below are not stories (excludeStories); this file's one story lists what the fixtures hold.

/** The stories' "now": 6 November 2026, the month after the fixtures' last. */
export const STORY_NOW = Date.UTC(2026, 10, 6, 12);
export const STORY_MONTH = '2026-11';
const TOKEN = 'storybook-memory-token-not-a-secret';

/** What the memory data API holds: the fixtures, nothing, or the fixtures with only two months rated (D-85). */
export type StoryData = 'fixtures' | 'empty' | 'two-rates';

export function memoryApi(data: StoryData = 'fixtures') {
  const api = new MemoryDataApi(new MemoryClock(STORY_NOW));
  api.allowToken(TOKEN);
  if (data !== 'empty') {
    const seed = fixtureSeed();
    if (data === 'two-rates') seed.rates = Object.fromEntries(Object.entries(seed.rates).slice(-2));
    api.seed(seed);
  }
  return { api, token: TOKEN };
}

/** The data of a memory read; a story whose read fails is a broken story, so it throws. */
export async function data<T>(result: Promise<DataApiResult<T>>): Promise<T> {
  const r = await result;
  if (!r.ok) throw new Error(`memory read failed: ${r.kind}`);
  return r.data;
}

/** How the story answers what the screen asks for after its first view: never (it stays loading) or a 409 (failed). */
export type Asking = 'never' | 'fails';

const realFetch = globalThis.fetch;

/** A query cache like the page's prefetch: fresh for good, no retries, with the given data under the hooks' keys. */
export function storyClient(asking: Asking, entries: [readonly unknown[], unknown][] = []): QueryClient {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!new URL(url, 'http://storybook.invalid').pathname.startsWith('/api/data/')) return realFetch(input, init);
    if (asking === 'fails') {
      return new Response(JSON.stringify({ error: { code: 'conflict' } }), { status: 409, headers: { 'content-type': 'application/json' } });
    }
    return new Promise<Response>(() => {});
  };
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  for (const [key, value] of entries) client.setQueryData(key, value);
  return client;
}

/** One screen as its page renders it: the page heading and lead, then the screen in its query cache. */
export function StoryPage({ client, title, lead, children }: { client: QueryClient; title: string; lead?: string; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <main style={{ display: 'grid', gap: 'var(--s5)' }}>
        <div>
          <h1>{title}</h1>
          {lead ? <p>{lead}</p> : null}
        </div>
        {children}
      </main>
    </QueryClientProvider>
  );
}

/** Waits until the screen shows `count` state blocks of this kind (StateBlock data-kind), in either language. */
export async function settled(canvasElement: HTMLElement, kind: 'error' | 'empty' | 'partial' | 'loading', count?: number) {
  await waitFor(() => {
    const found = canvasElement.querySelectorAll(`[data-kind="${kind}"]`).length;
    if (count === undefined) expect(found).toBeGreaterThan(0);
    else expect(found).toBe(count);
  });
}

/** Loaders return { client }; each screen story renders from it. */
export type Loaded = { loaded: { client: QueryClient } };

async function counts() {
  const { api, token } = memoryApi();
  const [txs, rates, review, imports] = await Promise.all([
    data(api.listTransactions(token, { from: '2025-01', to: '2026-12', limit: 200 })),
    data(api.rates(token)),
    data(api.review(token)),
    data(api.listImports(token, {})),
  ]);
  return { transactions: txs.items.length, rates: rates.items.length, review: review.items.length, imports: imports.items.length };
}

const meta: Meta = {
  title: 'Screens/Memory adapters',
  excludeStories: ['STORY_NOW', 'STORY_MONTH', 'memoryApi', 'data', 'storyClient', 'StoryPage', 'settled'],
  loaders: [async () => ({ counts: await counts() })],
  render: (_args, { loaded }) => {
    const c = (loaded as { counts: Record<string, number> }).counts;
    return (
      <DataTable.Root label="Fixtures">
        <DataTable.Header>
          <DataTable.Column>Read</DataTable.Column>
          <DataTable.Column align="end">Items</DataTable.Column>
        </DataTable.Header>
        <DataTable.Body>
          {Object.entries(c).map(([name, n]) => (
            <DataTable.Row key={name}>
              <DataTable.Cell>{name}</DataTable.Cell>
              <DataTable.Cell align="end">{n}</DataTable.Cell>
            </DataTable.Row>
          ))}
        </DataTable.Body>
      </DataTable.Root>
    );
  },
};
export default meta;

/** What the screen stories read: the first page of transactions (up to 200), the rates, the rows to review, the imports. */
export const Fixtures: StoryObj = {};
