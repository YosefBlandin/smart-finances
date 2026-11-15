// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import type { Example } from '@/domain/suggest';
import { dataKeys, type ReviewReply } from '@/queries/keys';
import { applyChoices } from '../model';
import { Review, type ChooseResult } from '../Review';
import type { ReviewRow } from '../View';

// T-ALL-1 to T-ALL-7 (category-suggestions AC-6 to AC-9, AC-11, D-19, D-24, D-25): Accept all confirms with a count and
// a per-category tally, saves the snapshot only, puts failed rows back with their suggestions and says how many, closes
// its confirmation on any other change, keeps the saving line until settle, stays inside the request limit and hides
// when history is partial. Made-up names and keys only.

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.refresh.mockClear();
});

const key = (n: number) => `${n}`.padStart(32, '0');
const row = (id: string, over: Partial<ReviewRow> = {}): ReviewRow => ({
  id,
  date: '2026-10-02',
  date_precision: 'day',
  kind: 'expense',
  amount: -1000,
  currency: 'ARS',
  category: 'Uncategorized',
  merchant: '',
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
const ex = (k: string, category: string, over: Partial<Example> = {}): Example => ({
  key: k,
  name: '',
  category,
  owner: true,
  kind: 'expense',
  date: '2026-06-01',
  ...over,
});

/** a and b are Groceries by key, c is Home by key, z has no pick. */
const ROWS = [
  row('a', { recipient_key: key(1) }),
  row('b', { recipient_key: key(2) }),
  row('c', { recipient_key: key(3) }),
  row('z', { merchant: 'Lugar Sin Pistas' }),
];
const EXAMPLES = [ex(key(1), 'Groceries'), ex(key(2), 'Groceries'), ex(key(3), 'Home')];

type Setup = {
  rows?: ReviewRow[];
  examples?: Example[];
  complete?: boolean;
  choose?: (c: { id: string }) => Promise<ChooseResult>;
  label?: () => Promise<ChooseResult>;
  /** Each data request; the list answers `serverRows`. */
  onFetch?: (path: string) => void;
  serverRows?: ReviewRow[];
};
function setup({
  rows = ROWS,
  examples = EXAMPLES,
  complete = true,
  choose = async () => ({ ok: true }),
  label,
  onFetch,
  serverRows = [],
}: Setup = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      onFetch?.(new URL(path, 'http://localhost').pathname);
      return new Response(JSON.stringify({ items: serverRows }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(dataKeys.review(), { items: rows });
  client.setQueryData(dataKeys.history(), { examples, complete });
  const spy = vi.fn(choose);
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <h1 tabIndex={-1}>To review</h1>
        <Review choose={spy} label={label} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { client, choose: spy };
}

const rowOf = (id: string) => screen.queryAllByRole('row').find((r) => within(r).queryByText(`SYNTHETIC ${id}`));
const acceptAll = () => screen.queryByRole('button', { name: /^Accept all/ });
const save = () => screen.queryByRole('button', { name: en.review.suggest.save });

describe('T-ALL-1: confirm first', () => {
  it('T-ALL-1 the first tap shows the count and the per-category tally; nothing is sent before Save', () => {
    const { choose } = setup();
    expect(acceptAll()?.textContent).toBe('Accept all (3 suggestions)');
    fireEvent.click(acceptAll()!);
    expect(screen.getByText(en.review.suggest.confirmTitle)).toBeTruthy();
    expect(screen.getByText('2 as Groceries')).toBeTruthy();
    expect(screen.getByText('1 as Home')).toBeTruthy();
    expect(save()).toBeTruthy();
    expect(screen.getByRole('button', { name: en.review.suggest.cancel })).toBeTruthy();
    expect(choose).not.toHaveBeenCalled();
  });

  it('T-ALL-1 Cancel closes it with nothing sent and gives focus back to Accept all', () => {
    const { choose } = setup();
    fireEvent.click(acceptAll()!);
    fireEvent.click(screen.getByRole('button', { name: en.review.suggest.cancel }));
    expect(save()).toBeNull();
    expect(document.activeElement).toBe(acceptAll());
    expect(choose).not.toHaveBeenCalled();
  });

  it('T-ALL-1 Accept all is not offered when no row has a pick', () => {
    setup({ rows: [row('z', { merchant: 'Lugar Sin Pistas' })] });
    expect(acceptAll()).toBeNull();
  });
});

describe('T-ALL-2: save', () => {
  it('T-ALL-2 Save sends the category and the approval for each snapshot row and leaves rows with no pick', async () => {
    const { choose } = setup({ serverRows: [row('z', { merchant: 'Lugar Sin Pistas' })] });
    fireEvent.click(acceptAll()!);
    await act(async () => {
      fireEvent.click(save()!);
    });
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(3));
    expect(choose.mock.calls.map(([c]) => c)).toEqual([
      { id: 'a', date: '2026-10-02', category: 'Groceries', approved: true },
      { id: 'b', date: '2026-10-02', category: 'Groceries', approved: true },
      { id: 'c', date: '2026-10-02', category: 'Home', approved: true },
    ]);
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(rowOf('a')).toBeUndefined();
    expect(rowOf('z')).toBeTruthy();
  });

  it('applyChoices takes every approved row off the list at once', () => {
    const reply = { items: ROWS } as ReviewReply;
    const out = applyChoices(reply, [
      { id: 'a', date: '2026-10-02', category: 'Groceries', approved: true },
      { id: 'c', date: '2026-10-02', category: 'Home', approved: true },
    ]);
    expect(out.items.map((r) => r.id)).toEqual(['b', 'z']);
  });
});

describe('T-ALL-3: some saves fail', () => {
  it('T-ALL-3 failed rows come back with their suggestions, the note counts them, and their examples leave the page', async () => {
    // s shares a's shop name but has no key: it gets a pick only from a's saved choice.
    const rows = [
      row('a', { recipient_key: key(1), merchant: 'Tienda Lunar' }),
      row('s', { merchant: 'Tienda Lunar' }),
      row('b', { recipient_key: key(2) }),
    ];
    let answerA: (r: ChooseResult) => void = () => {};
    const choose = (c: { id: string }) => (c.id === 'a' ? new Promise<ChooseResult>((r) => (answerA = r)) : Promise.resolve({ ok: true } as const));
    setup({ rows, examples: [ex(key(1), 'Shopping', { owner: false }), ex(key(2), 'Groceries')], choose, serverRows: rows.slice(0, 2) });
    expect(within(rowOf('s')!).queryByRole('button', { name: /^Accept / })).toBeNull();
    fireEvent.click(acceptAll()!);
    await act(async () => {
      fireEvent.click(save()!);
    });
    // While a is in flight its choice teaches s.
    await waitFor(() => expect(within(rowOf('s')!).getByRole('button', { name: 'Accept Shopping' })).toBeTruthy());
    await act(async () => {
      answerA({ ok: false, messageKey: 'review.saveFailed' });
    });
    await waitFor(() => expect(screen.getByText("1 row didn't save. It's back on the list.")).toBeTruthy());
    expect(within(rowOf('a')!).getByRole('button', { name: 'Accept Shopping' })).toBeTruthy();
    expect(within(rowOf('s')!).queryByRole('button', { name: /^Accept / })).toBeNull();
  });

  it('T-ALL-3 the note uses the plural for more than one row', async () => {
    setup({ choose: async (c) => (c.id === 'c' ? { ok: true } : { ok: false, messageKey: 'review.saveFailed' }), serverRows: ROWS });
    fireEvent.click(acceptAll()!);
    await act(async () => {
      fireEvent.click(save()!);
    });
    await waitFor(() => expect(screen.getByText("2 rows didn't save. They're back on the list.")).toBeTruthy());
    expect(rowOf('a')).toBeTruthy();
    expect(rowOf('b')).toBeTruthy();
  });
});

describe('T-ALL-3: the wait and the focus after a partial run', () => {
  it('T-ALL-3 with several saves waiting at once, the line shows the longest wait left', async () => {
    vi.useFakeTimers();
    try {
      const calls = new Map<string, number>();
      const waits: Record<string, number> = { a: 5, b: 2 };
      const choose = async (c: { id: string }): Promise<ChooseResult> => {
        const n = (calls.get(c.id) ?? 0) + 1;
        calls.set(c.id, n);
        const w = waits[c.id];
        return n === 1 && w !== undefined ? { ok: false, messageKey: 'review.saveFailed', retryAfterSeconds: w } : { ok: true };
      };
      setup({ choose, serverRows: [] });
      fireEvent.click(acceptAll()!);
      await act(async () => {
        fireEvent.click(save()!);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('Too many saves at once. Trying again in 5 seconds…')).toBeTruthy();
      // b's shorter wait counts down too, but never replaces a's.
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(screen.getByText('Too many saves at once. Trying again in 3 seconds…')).toBeTruthy();
      await act(() => vi.advanceTimersByTimeAsync(3_000));
      expect(calls.get('a')).toBe(2);
      expect(calls.get('b')).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T-ALL-3 when the run ends with rows back on the list, focus goes to the heading, not the page body', async () => {
    setup({ choose: async (c) => (c.id === 'a' ? { ok: false, messageKey: 'review.saveFailed' } : { ok: true }), serverRows: ROWS.slice(0, 1) });
    fireEvent.click(acceptAll()!);
    await act(async () => {
      fireEvent.click(save()!);
    });
    await waitFor(() => expect(screen.getByText("1 row didn't save. It's back on the list.")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'To review' }));
  });
});

describe('T-ALL-4: the confirmation closes on any other change', () => {
  it('T-ALL-4 a single choice closes it, and nothing from the snapshot is sent', async () => {
    const { choose } = setup();
    fireEvent.click(acceptAll()!);
    await act(async () => {
      fireEvent.click(within(rowOf('z')!).getByRole('button', { name: en.review.approve }));
    });
    expect(save()).toBeNull();
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith({ id: 'z', date: '2026-10-02', approved: true });
  });

  it('T-ALL-4 a label closes it', async () => {
    const rows = [row('a', { recipient_key: key(1), merchant: 'Made-up a', category: 'Groceries' }), row('b', { recipient_key: key(2) })];
    setup({ rows, label: async () => ({ ok: true }) });
    fireEvent.click(acceptAll()!);
    fireEvent.click(screen.getAllByRole('button', { name: en.label.open })[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.label.save }));
    });
    expect(save()).toBeNull();
  });

  it('T-ALL-4 a change to the review list data closes it', async () => {
    const { client } = setup();
    fireEvent.click(acceptAll()!);
    await act(async () => {
      client.setQueryData<ReviewReply>(dataKeys.review(), { items: ROWS.slice(1) } as ReviewReply);
    });
    // The query cache tells the screen on its next tick.
    await waitFor(() => expect(save()).toBeNull());
  });

  it('T-ALL-4 Save drops snapshot rows no longer listed, and a double tap sends each row once', async () => {
    const { client, choose } = setup();
    fireEvent.click(acceptAll()!);
    const button = save()!;
    await act(async () => {
      // b leaves the list in the same moment as the taps, before the screen renders again.
      client.setQueryData<ReviewReply>(dataKeys.review(), { items: ROWS.filter((r) => r.id !== 'b') } as ReviewReply);
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(choose.mock.calls.map(([c]) => c.id)).toEqual(['a', 'c']);
  });
});

describe('T-ALL-5: the saving line', () => {
  it('T-ALL-5 when every row is accepted the saving line shows and takes focus; the empty state and the heading wait for settle', async () => {
    const answers: ((r: ChooseResult) => void)[] = [];
    const rows = ROWS.slice(0, 3);
    setup({ rows, choose: () => new Promise<ChooseResult>((r) => answers.push(r)) });
    fireEvent.click(acceptAll()!);
    await act(async () => {
      fireEvent.click(save()!);
    });
    const line = await screen.findByText('Saving 3 rows…');
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(screen.queryByText(en.states.empty.review.title)).toBeNull();
    expect(line.closest('[tabindex="-1"]')).toBe(document.activeElement);
    await act(async () => {
      for (const answer of answers) answer({ ok: true });
    });
    await waitFor(() => expect(screen.getByText(en.states.empty.review.title)).toBeTruthy());
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'To review' }));
  });

  it('T-ALL-5 while it runs, the single-choice buttons and chips are disabled', async () => {
    const answers: ((r: ChooseResult) => void)[] = [];
    const { choose } = setup({ choose: () => new Promise<ChooseResult>((r) => answers.push(r)) });
    fireEvent.click(acceptAll()!);
    await act(async () => {
      fireEvent.click(save()!);
    });
    await act(async () => {
      fireEvent.click(within(rowOf('z')!).getByRole('button', { name: en.review.approve }));
    });
    expect(choose).toHaveBeenCalledTimes(3);
  });

  it('T-ALL-5 while it runs, chips are disabled and a label sends nothing', async () => {
    const answers: ((r: ChooseResult) => void)[] = [];
    const label = vi.fn(async (): Promise<ChooseResult> => ({ ok: true }));
    // s shares a's shop name but has no key: a's choice, in flight, gives it a chip while the run goes on (as T-ALL-3).
    // l has a category and no pick: it stays listed with its label form open.
    const rows = [
      row('a', { recipient_key: key(1), merchant: 'Tienda Lunar' }),
      row('s', { merchant: 'Tienda Lunar' }),
      row('l', { merchant: 'Otro Lugar Inventado', category: 'Groceries', recipient_key: key(7) }),
    ];
    setup({ rows, examples: [ex(key(1), 'Shopping', { owner: false })], label, choose: () => new Promise<ChooseResult>((r) => answers.push(r)) });
    fireEvent.click(within(rowOf('l')!).getByRole('button', { name: en.label.open }));
    fireEvent.click(acceptAll()!);
    await act(async () => {
      fireEvent.click(save()!);
    });
    await waitFor(() => expect(within(rowOf('s')!).getByRole('button', { name: 'Accept Shopping' })).toBeTruthy());
    const chips = screen.queryAllByRole('button', { name: /^(Accept|Use) / }).filter((b) => b.closest('[data-chips="ready"]'));
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect((chip as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.label.save }));
    });
    expect(label).not.toHaveBeenCalled();
    await act(async () => {
      for (const answer of answers) answer({ ok: true });
    });
  });
});

describe('T-ALL-6: the request limit', () => {
  it('T-ALL-6 60 accepted rows plus 12 history reads against a limiter of 120 a minute give no refusal', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`r${i}`, { recipient_key: key(i + 10) }));
    const examples = rows.map((r) => ex(r.recipient_key, 'Groceries'));
    let counted = 12;
    let refused = 0;
    const choose = async (): Promise<ChooseResult> => {
      counted += 1;
      if (counted > 120) {
        refused += 1;
        return { ok: false, messageKey: 'review.saveFailed', retryAfterSeconds: 61 };
      }
      return { ok: true };
    };
    setup({ rows, examples, choose, onFetch: () => (counted += 1) });
    fireEvent.click(acceptAll()!);
    await act(async () => {
      fireEvent.click(save()!);
    });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    // Still one a moment later: no second settle follows.
    await new Promise((r) => setTimeout(r, 50));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    counted += 2 * nav.refresh.mock.calls.length;
    expect(refused).toBe(0);
    expect(counted).toBeLessThanOrEqual(120);
  });
});

describe('T-ALL-7: partial history', () => {
  it('T-ALL-7 with history partial, Accept all is hidden and single chips still show', () => {
    setup({ complete: false });
    expect(acceptAll()).toBeNull();
    expect(within(rowOf('a')!).getByRole('button', { name: 'Accept Groceries' })).toBeTruthy();
  });
});
