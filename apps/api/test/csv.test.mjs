// T-IMP-2: the generic CSV importer reads the synthetic data shape (D-23). Fixtures are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGenericCsv } from '../src/ingest/csv.mjs';
import { FIELDS } from '../src/ingest/schema.mjs';

const HEADER = 'date,description,amount,currency,account';
const file = [
  HEADER,
  '01/10/2025,MP*COMBUSTIBLE,-9347.00,ARS,ARS Account',
  '2025-10-03,"  RENT, FLAT #1",-450000.00,ARS,ARS Account',
  '2025-10-03,SALARY,2500.50,USD,USD Account',
  '2025-10-04,BUTCHER,-446.89,ARS,ARS Account',
  '2025-10-04,BUTCHER,-446.89,ARS,ARS Account',
  '2025-02-30,BAD DATE,-1.00,ARS,ARS Account',
  '2025-10-05,BAD AMOUNT,lots,ARS,ARS Account',
  '2025-10-06,BAD CURRENCY,-1.00,pesos,ARS Account',
].join('\n');

test('T-IMP-2 rows map to the schema with source csv and stable ids', () => {
  const { transactions } = parseGenericCsv(file, { file: 'demo.csv' });
  assert.equal(transactions.length, 4);
  for (const t of transactions) assert.deepEqual(Object.keys(t), FIELDS);
  const [fuel, rent, salary] = transactions;
  assert.deepEqual(
    { date: fuel.date, kind: fuel.kind, amount: fuel.amount, currency: fuel.currency, category: fuel.category, source: fuel.source, source_ref: fuel.source_ref },
    { date: '2025-10-01', kind: 'expense', amount: -934700, currency: 'ARS', category: 'Uncategorized', source: 'csv', source_ref: 'demo.csv#row 1' },
  );
  assert.equal(fuel.date_precision, 'day');
  assert.equal(fuel.merchant, '');
  assert.equal(fuel.country, '');
  assert.deepEqual(fuel.flags, []);
  assert.equal(rent.description_raw, '  RENT, FLAT #1');
  assert.equal(salary.kind, 'income');
  assert.equal(salary.amount, 250050);
  assert.match(fuel.import_batch, /^csv:[0-9a-f]{12}$/);
  assert.ok(transactions.every((t) => t.import_batch === fuel.import_batch));
  // Same input, same ids.
  assert.deepEqual(parseGenericCsv(file, { file: 'other-name.csv' }).transactions.map((t) => t.id), transactions.map((t) => t.id));
});

test('T-IMP-2 an exact duplicate row keeps the first and is an info issue, not a skipped row', () => {
  const { transactions, issues } = parseGenericCsv(file, { file: 'demo.csv' });
  assert.equal(transactions.filter((t) => t.description_raw === 'BUTCHER').length, 1);
  const dup = issues.filter((i) => i.info);
  assert.equal(dup.length, 1);
  assert.equal(dup[0].ref, 'demo.csv#row 5');
});

test('T-IMP-2 an unreadable row becomes an issue with its ref, line and reason', () => {
  const { issues } = parseGenericCsv(file, { file: 'demo.csv' });
  const bad = issues.filter((i) => !i.info);
  assert.deepEqual(bad.map((i) => i.ref), ['demo.csv#row 6', 'demo.csv#row 7', 'demo.csv#row 8']);
  for (const i of bad) {
    assert.equal(typeof i.line, 'string');
    assert.ok(i.issue.length > 0);
  }
});

test('T-IMP-2 a file without the header throws', () => {
  assert.throws(() => parseGenericCsv('2025-10-01,X,-1.00,ARS,A\n', { file: 'x.csv' }), /header/);
  assert.throws(() => parseGenericCsv('', { file: 'x.csv' }), /header/);
});

test('T-IMP-2 the committed synthetic file parses with no skipped rows', () => {
  const text = readFileSync(new URL('../../../data/synthetic/transactions.csv', import.meta.url), 'utf8');
  const { transactions, issues } = parseGenericCsv(text, { file: 'transactions.csv' });
  assert.ok(transactions.length > 600);
  assert.deepEqual(issues.filter((i) => !i.info), []);
});
