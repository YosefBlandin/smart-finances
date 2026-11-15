// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import type { Suggestion } from '@/domain/suggest';
import { ReviewView, type ReviewChoice, type ReviewRow } from '../View';

// T-KEY-1 to T-KEY-3 (category-suggestions AC-10): payments rows are one roving tab stop; on the row itself Enter takes
// the pick, 1 to 3 take the chips and Up and Down move; keys inside the picker or chips are left alone; a held Enter
// saves one row; when a row leaves, focus goes to the next row, or to the heading. Made-up rows only.

afterEach(cleanup);

const row = (id: string, over: Partial<ReviewRow> = {}): ReviewRow => ({
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

const SUGGESTIONS = new Map<string, Suggestion>([
  ['a', { pick: 'Groceries', others: ['Home', 'Pets'], level: 'key' }],
  ['b', { pick: 'Travel', others: ['Gifts'], level: 'name' }],
  ['c', { pick: 'Home', others: [], level: 'rule' }],
]);

function Screen({ rows, onChoose }: { rows: ReviewRow[]; onChoose: (c: ReviewChoice) => void }) {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <h1 tabIndex={-1}>To review</h1>
      <ReviewView rows={rows} failed={false} onChoose={onChoose} suggest={{ byRow: SUGGESTIONS, settled: true, modelPending: false }} />
    </NextIntlClientProvider>
  );
}

const rowEl = (id: string) => screen.getAllByRole('row').find((r) => within(r).queryByText(`SYNTHETIC ${id}`))!;
const ROWS = [row('a'), row('o', { source: 'notion' }), row('b'), row('c')];

describe('T-KEY-1: keys on a focused row', () => {
  it('T-KEY-1 payments rows are one roving tab stop with their shortcuts named', () => {
    render(<Screen rows={ROWS} onChoose={() => {}} />);
    expect(rowEl('a').getAttribute('tabindex')).toBe('0');
    expect(rowEl('b').getAttribute('tabindex')).toBe('-1');
    expect(rowEl('o').getAttribute('tabindex')).toBeNull();
    expect(rowEl('a').getAttribute('aria-keyshortcuts')).toBe('Enter 1 2 3 ArrowUp ArrowDown');
    expect(screen.getByText(en.review.suggest.keys)).toBeTruthy();
  });

  it('T-KEY-1 Enter accepts the pick and 1 to 3 take the chips', () => {
    const onChoose = vi.fn();
    render(<Screen rows={ROWS} onChoose={onChoose} />);
    fireEvent.keyDown(rowEl('a'), { key: 'Enter' });
    fireEvent.keyUp(rowEl('a'), { key: 'Enter' });
    fireEvent.keyDown(rowEl('a'), { key: '3' });
    fireEvent.keyUp(rowEl('a'), { key: '3' });
    fireEvent.keyDown(rowEl('b'), { key: '2' });
    fireEvent.keyUp(rowEl('b'), { key: '2' });
    // c has one chip only: 2 does nothing.
    fireEvent.keyDown(rowEl('c'), { key: '2' });
    expect(onChoose.mock.calls.map(([c]) => c)).toEqual([
      { id: 'a', date: '2026-10-02', category: 'Groceries', approved: true },
      { id: 'a', date: '2026-10-02', category: 'Pets', approved: true },
      { id: 'b', date: '2026-10-02', category: 'Gifts', approved: true },
    ]);
  });

  it('T-KEY-1 Up and Down move focus between payments rows and move the tab stop', () => {
    render(<Screen rows={ROWS} onChoose={() => {}} />);
    rowEl('a').focus();
    fireEvent.keyDown(rowEl('a'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowEl('b'));
    expect(rowEl('b').getAttribute('tabindex')).toBe('0');
    expect(rowEl('a').getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(rowEl('b'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowEl('c'));
    fireEvent.keyDown(rowEl('c'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowEl('c'));
    fireEvent.keyDown(rowEl('c'), { key: 'ArrowUp' });
    fireEvent.keyDown(rowEl('b'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rowEl('a'));
  });

  it('T-KEY-1 keys inside the chips or the picker do their usual job only', () => {
    const onChoose = vi.fn();
    render(<Screen rows={ROWS} onChoose={onChoose} />);
    const a = within(rowEl('a'));
    fireEvent.keyDown(a.getByRole('button', { name: 'Use Home' }), { key: '1' });
    fireEvent.keyDown(a.getByRole('button', { name: en.review.approve }), { key: 'Enter' });
    fireEvent.keyDown(a.getByRole('button', { name: 'Use Home' }), { key: 'ArrowDown' });
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('T-KEY-2: a held Enter', () => {
  it('T-KEY-2 repeat events are ignored and the next row takes no accept key until a keyup', () => {
    const onChoose = vi.fn();
    render(<Screen rows={ROWS} onChoose={onChoose} />);
    fireEvent.keyDown(rowEl('a'), { key: 'Enter' });
    fireEvent.keyDown(rowEl('a'), { key: 'Enter', repeat: true });
    // Focus moved on to b while the key is still down: no accept there.
    fireEvent.keyDown(rowEl('b'), { key: 'Enter' });
    fireEvent.keyDown(rowEl('b'), { key: '1' });
    expect(onChoose).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(rowEl('b'), { key: 'Enter' });
    fireEvent.keyDown(rowEl('b'), { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledTimes(2);
    expect(onChoose.mock.calls[1]?.[0]).toMatchObject({ id: 'b', category: 'Travel' });
  });
});

describe('T-KEY-3: focus after a row leaves', () => {
  it('T-KEY-3 focus moves to the next row, then to the heading when no row is left', () => {
    const { rerender } = render(<Screen rows={ROWS} onChoose={() => {}} />);
    rowEl('a').focus();
    rerender(<Screen rows={[row('o', { source: 'notion' }), row('b'), row('c')]} onChoose={() => {}} />);
    expect(document.activeElement).toBe(rowEl('b'));
    expect(rowEl('b').getAttribute('tabindex')).toBe('0');
    rerender(<Screen rows={[row('o', { source: 'notion' }), row('c')]} onChoose={() => {}} />);
    expect(document.activeElement).toBe(rowEl('c'));
    rerender(<Screen rows={[row('o', { source: 'notion' })]} onChoose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'To review' }));
  });

  it('T-KEY-3 a row leaving while focus is elsewhere moves no focus', () => {
    const { rerender } = render(<Screen rows={ROWS} onChoose={() => {}} />);
    const approve = within(rowEl('c')).getByRole('button', { name: en.review.approve });
    approve.focus();
    rerender(<Screen rows={[row('o', { source: 'notion' }), row('b'), row('c')]} onChoose={() => {}} />);
    expect(document.activeElement).toBe(approve);
  });
});
