import { describe, expect, it } from 'vitest';
import type { RatesReply, ReviewReply } from '@/queries/keys';
import { undoRate, withRate } from '../rates/model';
import { applyChoice, undoChoice } from './model';

// T-WSCR-19 (D-131): a refused review choice or rate rolls back only itself; another choice still in flight stays
// shown. Synthetic rows only.

type Row = ReviewReply['items'][number];
const row = (id: string, category = 'uncategorized'): Row =>
  ({
    id,
    date: '2026-10-02',
    category,
    merchant: `SYNTHETIC ${id}`,
    amount: -100,
    currency: 'ARS',
    source: 'mercadopago',
    reasons: ['needs_review'],
  }) as unknown as Row;
const reply = (...rows: Row[]): ReviewReply => ({ items: rows }) as ReviewReply;

describe('T-WSCR-19: rollback of one choice', () => {
  it('T-WSCR-19: a refused approval comes back in its place while another approval stays applied', () => {
    const before = reply(row('a'), row('b'), row('c'));
    // Two approvals in flight: b, then c.
    const shown = applyChoice(applyChoice(before, { id: 'b', date: '2026-10-02', approved: true }), { id: 'c', date: '2026-10-02', approved: true });
    // b is refused: only b comes back, in its place; c stays approved.
    expect(undoChoice(shown, before, 'b').items.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('T-WSCR-19: a refused category goes back to the row’s previous one while another row keeps its new category', () => {
    const before = reply(row('a'), row('b'));
    const shown = applyChoice(applyChoice(before, { id: 'a', date: '2026-10-02', category: 'groceries' }), {
      id: 'b',
      date: '2026-10-02',
      category: 'transport',
    });
    const undone = undoChoice(shown, before, 'a');
    expect(undone.items.map((r) => [r.id, r.category])).toEqual([
      ['a', 'uncategorized'],
      ['b', 'transport'],
    ]);
  });

  it('T-WSCR-19: a refused rate goes back to that month’s previous rate, or away, while another month keeps its new rate', () => {
    const before: RatesReply = { items: [{ month: '2026-09', ars_per_usd: 1375 }] };
    const shown = withRate(withRate(before, '2026-09', 1400), '2026-10', 1450.5);
    expect(undoRate(shown, before, '2026-09').items).toEqual([
      { month: '2026-09', ars_per_usd: 1375 },
      { month: '2026-10', ars_per_usd: 1450.5 },
    ]);
    expect(undoRate(shown, before, '2026-10').items).toEqual([{ month: '2026-09', ars_per_usd: 1400 }]);
  });
});
