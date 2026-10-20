// Fixture is made up; it only copies the layout and date quirks of the budget template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBudgetWorkbook, resolveDate } from '../src/ingest/excel.mjs';
import { combine } from '../src/ingest/reconcile.mjs';
import { readWorkbook } from '../src/ingest/xlsx.mjs';
import { makeXlsx, serial } from './fixtures/xlsx.mjs';

const header = { B4: 'Date', C4: 'Amount', D4: 'Description', E4: 'Category', G4: 'Date', H4: 'Amount', I4: 'Description', J4: 'Category' };
const summary = (expenseTotal, incomeTotal) => ({
  E26: expenseTotal,
  K26: incomeTotal,
  B27: 'Food', B28: 'Home', B29: 'Pets', B30: 'Utilities', B31: 'Food out',
  H27: 'Paycheck', H28: 'Savings', H29: 'Other',
});

function budget(rows, totals, sheetOverrides = {}) {
  const t = { ...header };
  rows.forEach(([side, date, amount, desc, cat], i) => {
    const c = side === 'income' ? ['G', 'H', 'I', 'J'] : ['B', 'C', 'D', 'E'];
    const r = 5 + i;
    [date, amount, desc, cat].forEach((v, k) => {
      if (v != null) t[`${c[k]}${r}`] = v;
    });
  });
  return makeXlsx({ Summary: summary(...totals), Transactions: { ...t, ...sheetOverrides } });
}

const AUG = [
  ['expense', serial(2030, 8, 3), 380, '$RENT', 'Home'], // day known
  ['expense', serial(2030, 12, 8), 20, 'Food', 'Food'], // typed 12/08, stored as Dec 8
  ['expense', '16/08/2030', 9, 'Food out', 'Food out'], // text, day-first
  ['expense', '21//08/2030', 5, 'Uber', 'Transportation'], // malformed but readable; category not in Summary
  ['expense', null, 18, 'Cat items', 'Pets'], // no date
  ['expense', serial(2030, 7, 14), 12, 'Food', 'Food'], // dated in another month
  ['expense', serial(2030, 8, 5), null, 'Forgot the amount', 'Food'], // skipped
  ['expense', serial(2030, 8, 6), 20, 'Cursor', 'Utilities'],
  ['income', serial(2030, 8, 1), 1200, 'Salary', 'Paycheck'],
  ['income', '16/08/2030', 300, 'Partner share of rent', 'Other'],
];
// Summary sees everything except the Transportation row (5): 380+20+9+18+12+20 = 459
const file = 'Monthly budget AUG_2030.xlsx';
const { transactions, issues, check } = parseBudgetWorkbook(budget(AUG, [459, 1500]), { file });
const row = (desc) => transactions.find((t) => t.description_raw === desc);

test('xlsx reader resolves shared, rich and inline strings and numbers', () => {
  const wb = readWorkbook(makeXlsx({ S: { A1: '$shared text', A2: 'a & b < c', A3: 42.5 } }));
  assert.deepEqual(wb.S, { A1: 'shared text', A2: 'a & b < c', A3: '42.5' });
  assert.throws(() => readWorkbook(Buffer.from('not a zip at all, just text')), /not an xlsx/);
});

test('dates: exact, swapped, text, malformed, missing and conflicting', () => {
  assert.deepEqual(resolveDate(serial(2030, 8, 3), 2030, 8), { day: 3 });
  assert.deepEqual(resolveDate(serial(2030, 12, 8), 2030, 8), { day: 12, flag: 'day_month_swapped' });
  assert.deepEqual(resolveDate('16/08/2030', 2030, 8), { day: 16 });
  assert.deepEqual(resolveDate('08/16/2030', 2030, 8), { day: 16, flag: 'day_month_swapped' });
  assert.deepEqual(resolveDate('6/82030', 2030, 8), { day: 6 });
  assert.deepEqual(resolveDate(null, 2030, 8), { day: null, flag: 'no_date' });
  assert.equal(resolveDate(serial(2030, 7, 14), 2030, 8).flag, 'date_conflict');
  assert.equal(resolveDate('31/02/2030', 2030, 2).flag, 'date_conflict');

  assert.equal(row('RENT').date, '2030-08-03');
  assert.equal(row('Uber').date, '2030-08-21');
  assert.equal(row('Cat items').date_precision, 'month');
  const conflict = transactions.find((t) => t.flags.includes('date_conflict'));
  assert.equal(conflict.date, '2030-08-01');
  assert.equal(conflict.date_precision, 'month');
  assert.deepEqual(check.dates, { day: 6, swapped: 1, missing: 1, conflict: 1 });
});

test('reconciles with the Summary sheet, counting rows it cannot see', () => {
  assert.equal(check.month, '2030-08');
  assert.deepEqual(check.expense, { total: 46400, summaryTotal: 45900, unlisted: 500, matches: true });
  assert.equal(check.income.matches, true);
  const bad = parseBudgetWorkbook(budget(AUG, [400, 1500]), { file }).check;
  assert.equal(bad.expense.matches, false);
});

test('rows without an amount are reported, not dropped silently', () => {
  assert.equal(transactions.some((t) => t.description_raw === 'Forgot the amount'), false);
  assert.ok(issues.some((i) => !i.info && /without a numeric amount/.test(i.issue)));
});

test('categories: sheet category first, refined from the description when vague', () => {
  assert.equal(row('RENT').category, 'Housing & utilities');
  assert.equal(row('Cat items').category, 'Pets');
  assert.equal(row('Cursor').category, 'Subscriptions & software');
  assert.equal(row('Food out').category, 'Dining out');
  assert.equal(row('Uber').category, 'Transport');
  assert.equal(row('Salary').kind, 'income');
  assert.ok(row('Partner share of rent').flags.includes('needs_review'));
  assert.ok(transactions.every((t) => t.currency === 'USD' && t.source === 'excel'));
  assert.equal(row('RENT').amount, -38000);
});

test('a row filed in one month and entered again in the month it is dated is flagged', () => {
  const july = parseBudgetWorkbook(budget([['expense', serial(2030, 7, 14), 12, 'Food', 'Food']], [12, 0]), { file: 'Monthly budget JUL_2030.xlsx' });
  const { possibleDuplicates, transactions: all } = combine([{ transactions, issues }, july]);
  assert.equal(possibleDuplicates.length, 1);
  assert.equal(possibleDuplicates[0].twin.date, '2030-07-14');
  assert.ok(all.find((t) => t.source_ref.includes('AUG_2030') && t.flags.includes('possible_duplicate')));
});

test('rejects files it cannot place or read', () => {
  assert.throws(() => parseBudgetWorkbook(budget(AUG, [459, 1500]), { file: 'budget.xlsx' }), /month from the file name/);
  assert.throws(() => parseBudgetWorkbook(budget(AUG, [459, 1500], { D4: 'Notes' }), { file }), /header/);
});
