// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import es from '../../../../messages/es.json';
import type { Example, Suggestion } from '@/domain/suggest';
import { dataKeys } from '@/queries/keys';
import { Review, type ChooseResult } from '../Review';
import { ReviewView, type ReviewRow } from '../View';

// T-UI-1 to T-UI-5 (category-suggestions AC-1 to AC-5, AC-11, AC-16, AC-19, D-19, D-26): suggestion chips on payments
// review rows, one tap to save and approve, the picker and Approve kept, space kept while suggestions or a model can
// still arrive, and choices on the page teaching the other rows. Made-up names and keys only.

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Intl({ children, locale = 'en' }: { children: ReactNode; locale?: 'en' | 'es' }) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

const reviewRow = (id: string, over: Partial<ReviewRow> = {}): ReviewRow => ({
  id,
  date: '2026-10-02',
  date_precision: 'day',
  kind: 'expense',
  amount: -1000,
  currency: 'ARS',
  category: 'Uncategorized',
  merchant: `Comercio Inventado ${id}`,
  recipient_key: '',
  description_raw: `SYNTHETIC ${id}`,
  source: 'mercadopago',
  source_ref: id,
  country: 'AR',
  flags: ['needs_review'],
  import_batch: 'b',
  reasons: ['needs_review'],
  ...over,
});

const ex = (over: Partial<Example>): Example => ({
  key: '',
  name: '',
  category: 'Groceries',
  owner: true,
  kind: 'expense',
  date: '2026-06-01',
  ...over,
});

/** Owner examples: KEY_A is Groceries; the owner also uses Home (twice) and Pets for expenses. */
const EXAMPLES = [
  ex({ key: KEY_A, category: 'Groceries' }),
  ex({ name: 'casa ficticia', category: 'Home' }),
  ex({ name: 'casa ficticia', category: 'Home' }),
  ex({ name: 'veterinaria ficticia', category: 'Pets' }),
];

type Setup = {
  rows: ReviewRow[];
  examples?: Example[];
  history?: 'ready' | 'pending';
  choose?: (c: unknown) => Promise<ChooseResult>;
  locale?: 'en' | 'es';
};
function setup({ rows, examples = EXAMPLES, history = 'ready', choose = async () => ({ ok: true }), locale = 'en' }: Setup) {
  // History that is not seeded never answers, so it stays loading.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(dataKeys.review(), { items: rows });
  if (history === 'ready') client.setQueryData(dataKeys.history(), { examples, complete: true });
  const spy = vi.fn(choose);
  const view = render(
    <QueryClientProvider client={client}>
      <Intl locale={locale}>
        <Review choose={spy} />
      </Intl>
    </QueryClientProvider>,
  );
  return { client, choose: spy, view };
}

const rowOf = (id: string) => screen.getAllByRole('row').find((r) => within(r).queryByText(`SYNTHETIC ${id}`));

describe('T-UI-1: chips', () => {
  it('T-UI-1 a row with a pick shows the pick and its others as buttons named by category (en)', () => {
    setup({ rows: [reviewRow('a', { recipient_key: KEY_A })] });
    const row = within(rowOf('a')!);
    expect(row.getByRole('button', { name: 'Accept Groceries' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Use Home' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Use Pets' })).toBeTruthy();
  });

  it('T-UI-1 the chips use the Spanish words and category names (es)', () => {
    setup({ rows: [reviewRow('a', { recipient_key: KEY_A })], locale: 'es' });
    const row = within(rowOf('a')!);
    expect(row.getByRole('button', { name: `Aceptar ${es.categories.groceries}` })).toBeTruthy();
    expect(row.getByRole('button', { name: `Usar ${es.categories.home}` })).toBeTruthy();
    expect(row.getByRole('button', { name: `Usar ${es.categories.pets}` })).toBeTruthy();
  });
});

describe('T-UI-2: one tap', () => {
  it('T-UI-2 tapping the pick sends one choose with the category and approved true, and the row leaves at once', async () => {
    const { choose } = setup({ rows: [reviewRow('a', { recipient_key: KEY_A }), reviewRow('z')] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept Groceries' }));
    });
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith({ id: 'a', date: '2026-10-02', category: 'Groceries', approved: true });
    expect(rowOf('a')).toBeUndefined();
    expect(rowOf('z')).toBeTruthy();
  });

  it('T-UI-2 tapping another likely category sends that category with approved true', async () => {
    const { choose } = setup({ rows: [reviewRow('a', { recipient_key: KEY_A })] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Pets' }));
    });
    expect(choose).toHaveBeenCalledWith({ id: 'a', date: '2026-10-02', category: 'Pets', approved: true });
  });
});

describe('T-UI-3: no pick', () => {
  it('T-UI-3 a payments row with no pick shows the picker and Approve as today, and no chips', () => {
    setup({ rows: [reviewRow('n', { merchant: 'Lugar Sin Pistas' })] });
    const row = within(rowOf('n')!);
    expect(row.queryByRole('button', { name: /^(Accept|Use) / })).toBeNull();
    expect(row.getByRole('button', { name: en.review.approve })).toBeTruthy();
    expect(row.getByText(en.review.categorize)).toBeTruthy();
  });

  it('T-UI-3 rows with chips keep the picker and Approve too', () => {
    setup({ rows: [reviewRow('a', { recipient_key: KEY_A })] });
    const row = within(rowOf('a')!);
    expect(row.getByRole('button', { name: en.review.approve })).toBeTruthy();
    expect(row.getByText(en.review.categorize)).toBeTruthy();
  });
});

describe('T-UI-4: reserved space', () => {
  it('T-UI-4 until history settles, payments rows hold a hidden placeholder and no chips; other sources hold none', () => {
    const { view } = setup({
      rows: [reviewRow('a', { recipient_key: KEY_A }), reviewRow('n'), reviewRow('o', { source: 'notion' })],
      history: 'pending',
    });
    expect(screen.queryByRole('button', { name: /^(Accept|Use) / })).toBeNull();
    const holders = view.container.querySelectorAll('[data-chips="placeholder"]');
    expect(holders).toHaveLength(2);
    for (const h of holders) expect(h.getAttribute('aria-hidden')).toBe('true');
    expect(within(rowOf('o')!).queryByText(en.review.approve)).toBeNull();
  });

  it('T-UI-4 the placeholder and the chips share one box, and rows with no pick keep it only while a model can still arrive', () => {
    const rows = [reviewRow('a'), reviewRow('n')];
    const suggestions = new Map<string, Suggestion>([['a', { pick: 'Home', others: [], level: 'key' }]]);
    const view = (modelPending: boolean) => (
      <Intl>
        <ReviewView rows={rows} failed={false} onChoose={() => {}} suggest={{ byRow: suggestions, settled: true, modelPending }} />
      </Intl>
    );
    const { container, rerender } = render(view(true));
    const chips = container.querySelector('[data-chips="ready"]');
    const holder = container.querySelector('[data-chips="placeholder"]');
    expect(chips?.className).toBeTruthy();
    expect(holder?.className).toBe(chips?.className);
    expect(within(rowOf('n')!).queryByRole('button', { name: /^Accept / })).toBeNull();
    rerender(view(false));
    expect(container.querySelector('[data-chips="placeholder"]')).toBeNull();
    expect(container.querySelector('[data-chips="ready"]')).toBeTruthy();
  });
});

describe('T-UI-5: the page learns', () => {
  it('T-UI-5 a choice on one row changes a similar row’s pick without a reload; a refused choice takes its example back out', async () => {
    let answer: (r: ChooseResult) => void = () => {};
    const choose = () => new Promise<ChooseResult>((resolve) => (answer = resolve));
    // KEY_B is a rule-categorized Shopping key; the owner also uses Home, Groceries and Pets.
    const examples = [...EXAMPLES, ex({ key: KEY_B, category: 'Shopping', owner: false })];
    setup({ rows: [reviewRow('a', { recipient_key: KEY_B }), reviewRow('b', { recipient_key: KEY_B })], examples, choose });
    expect(within(rowOf('b')!).getByRole('button', { name: 'Accept Shopping' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(rowOf('a')!).getByRole('button', { name: 'Use Home' }));
    });
    // a left the list; b now suggests the owner's choice.
    expect(rowOf('a')).toBeUndefined();
    expect(within(rowOf('b')!).getByRole('button', { name: 'Accept Home' })).toBeTruthy();
    await act(async () => {
      answer({ ok: false, messageKey: 'review.saveFailed' });
    });
    expect(rowOf('a')).toBeTruthy();
    expect(within(rowOf('b')!).getByRole('button', { name: 'Accept Shopping' })).toBeTruthy();
  });
});
