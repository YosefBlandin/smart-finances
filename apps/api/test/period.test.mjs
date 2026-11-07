// T-IMP-1: the period a file covers decides which stored rows its import replaces (D-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodOf } from '../src/ingest/period.mjs';

const mp = (month, rowsOutsideMonth) => ({ transactions: [], issues: [], check: { file: 'r.csv', month, rowsOutsideMonth } });

test('T-IMP-1 a payments report covers its check month', () => {
  assert.deepEqual(periodOf('mercadopago', mp('2026-05', 0)), { period: '2026-05', skipped: [] });
});

test('T-IMP-1 a payments report with rows outside its month names how many were left out', () => {
  const { period, skipped } = periodOf('mercadopago', mp('2026-05', 3));
  assert.equal(period, '2026-05');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].where, 'file');
  assert.match(skipped[0].reason, /\b3 rows\b.*2026-05/);
});

test('T-IMP-1 a budget workbook covers its check month', () => {
  assert.deepEqual(periodOf('excel', { transactions: [], issues: [], check: { file: 'b_Mar_2026.xlsx', month: '2026-03' } }), { period: '2026-03', skipped: [] });
});

test('T-IMP-1 a notes log covers the whole file', () => {
  assert.deepEqual(periodOf('notion', { transactions: [], issues: [] }), { period: 'log', skipped: [] });
});

test('T-IMP-1 a generic CSV covers the whole file', () => {
  assert.deepEqual(periodOf('csv', { transactions: [], issues: [] }), { period: 'log', skipped: [] });
});

test('T-IMP-1 a month source without a valid check month throws', () => {
  assert.throws(() => periodOf('excel', { transactions: [], check: {} }), /month/);
  assert.throws(() => periodOf('mercadopago', { transactions: [], check: { month: '2026-13', rowsOutsideMonth: 0 } }), /month/);
});

test('T-IMP-1 an unknown source throws', () => {
  assert.throws(() => periodOf('bank', { transactions: [] }), /unknown source/);
});
