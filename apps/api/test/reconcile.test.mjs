// T-IMP-4: the possible-duplicate check is exported for the parser and combine keeps its output.
// Fixtures are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combine, findPossibleDuplicates } from '../src/ingest/reconcile.mjs';

const row = (over) => ({
  id: over.id,
  date: over.date,
  date_precision: over.precision ?? 'day',
  kind: 'expense',
  amount: over.amount ?? -1000,
  currency: 'ARS',
  category: 'Groceries',
  merchant: '',
  description_raw: over.description ?? 'Market',
  source: 'excel',
  source_ref: over.source_ref,
  country: 'AR',
  flags: [],
  import_batch: over.batch ?? 'excel:aaaaaaaaaaaa',
});

// March's workbook holds a row dated in February; February's workbook has the same row that day.
function fixture() {
  const march = {
    transactions: [row({ id: 'm1', date: '2026-03-01', precision: 'month', source_ref: 'b_Mar_2026.xlsx#Expenses!A5 (filed in March)' }), row({ id: 'm2', date: '2026-03-02', source_ref: 'b_Mar_2026.xlsx#Expenses!A6 (x)' })],
    issues: [{ ref: 'b_Mar_2026.xlsx#Expenses!A5', statedDate: '2026-02-10', amount: -1000, description: 'MARKET', info: true, issue: 'date in another month' }],
  };
  const feb = { transactions: [row({ id: 'f1', date: '2026-02-10', source_ref: 'b_Feb_2026.xlsx#Expenses!A9 (y)', batch: 'excel:bbbbbbbbbbbb' })], issues: [] };
  return [march, feb];
}

test('T-IMP-4 findPossibleDuplicates flags the row whose twin is in another file', () => {
  const [march, feb] = fixture();
  const all = [...march.transactions, ...feb.transactions];
  const found = findPossibleDuplicates(march.issues, all);
  assert.equal(found.length, 1);
  assert.equal(found[0].row.id, 'm1');
  assert.equal(found[0].twin.id, 'f1');
  assert.deepEqual(all.find((t) => t.id === 'm1').flags, ['possible_duplicate']);
  assert.deepEqual(all.find((t) => t.id === 'f1').flags, []);
});

test('T-IMP-4 findPossibleDuplicates is safe to run twice on the same rows', () => {
  const [march, feb] = fixture();
  const all = [...march.transactions, ...feb.transactions];
  findPossibleDuplicates(march.issues, all);
  findPossibleDuplicates(march.issues, all);
  assert.deepEqual(all.find((t) => t.id === 'm1').flags, ['possible_duplicate']);
});

test('T-IMP-4 no twin, no flag', () => {
  const [march] = fixture();
  assert.deepEqual(findPossibleDuplicates(march.issues, march.transactions), []);
  assert.deepEqual(march.transactions[0].flags, []);
});

test('T-IMP-4 combine flags the same rows as before', () => {
  const out = combine(fixture());
  assert.deepEqual(out.possibleDuplicates.map(({ row: r, twin }) => [r.id, twin.id]), [['m1', 'f1']]);
  assert.equal(out.transactions.find((t) => t.id === 'm1').flags.join('|'), 'possible_duplicate');
  assert.equal(out.duplicates, 0);
  assert.deepEqual(out.transactions.map((t) => t.id), ['f1', 'm1', 'm2']);
});
