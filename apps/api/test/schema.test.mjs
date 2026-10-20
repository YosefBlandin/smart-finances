import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromCents, toCents, toCsv } from '../src/ingest/schema.mjs';

test('money round-trips through integer cents', () => {
  assert.equal(toCents('83106.55'), 8310655);
  assert.equal(toCents('-12992.77'), -1299277);
  assert.equal(toCents('9.3'), 930);
  assert.equal(toCents('290,00'), 29000);
  assert.equal(fromCents(-1299277), '-12992.77');
  assert.equal(fromCents(5), '0.05');
  assert.throws(() => toCents('1e3'));
});

test('csv output neutralises formulas in text cells but not in amounts', () => {
  const csv = toCsv([{ id: 'x', amount: -500, description_raw: '=HYPERLINK("http://evil")', flags: ['a', 'b'] }]);
  const line = csv.trim().split('\n')[1];
  assert.match(line, /"'=HYPERLINK\(""http:\/\/evil""\)"/);
  assert.match(line, /,-5\.00,/);
  assert.match(line, /a\|b/);
});
