// Fixture is made up; it only copies the quirks of the real log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotionLog } from '../src/ingest/notion.mjs';

const log = `Nov - 2030

- Food: 18$
- Food: 18$
- Taxi 10$
- Food out: 23$ + 12$
- Food: 70$ BCV
- Cash: 10$
- Changing USD to bs: 20$
- Zinli: 25$
AR
Food:72$
Rent: 211$

December:
Fruits: 5.3$

January:

income:
1200 USD

EXPENSES

Lending Someone: 320$ - 30$ = 290,00$
Gift: Course: 100 + Products: 54$
Mystery thing: 9$
Food: ??$
`;

const { transactions, issues } = parseNotionLog(log, { file: 'log.md' });
const find = (text) => transactions.filter((t) => t.description_raw === text);

test('rolls the year over at January and keeps month precision', () => {
  assert.equal(find('Food: 18$')[0].date, '2030-11-01');
  assert.equal(find('Fruits: 5.3$')[0].date, '2030-12-01');
  assert.equal(find('1200 USD')[0].date, '2031-01-01');
  assert.ok(transactions.every((t) => t.date_precision === 'month' && t.currency === 'USD'));
});

test('identical lines in one month are separate rows with separate ids', () => {
  const food = find('Food: 18$');
  assert.equal(food.length, 2);
  assert.notEqual(food[0].id, food[1].id);
});

test('amount quirks', () => {
  assert.equal(find('Taxi 10$')[0].amount, -1000);
  assert.equal(find('Food out: 23$ + 12$')[0].amount, -3500);
  assert.ok(find('Food out: 23$ + 12$')[0].flags.includes('summed'));
  assert.equal(find('Fruits: 5.3$')[0].amount, -530);
  assert.ok(find('Food: 70$ BCV')[0].flags.includes('bcv_rate'));
  assert.equal(find('Gift: Course: 100 + Products: 54$')[0].amount, -15400);
  assert.equal(find('1200 USD')[0].amount, 120000);
});

test('kinds and categories for the special labels', () => {
  const lend = find('Lending Someone: 320$ - 30$ = 290,00$')[0];
  assert.equal(lend.kind, 'loan_out');
  assert.equal(lend.amount, -29000);
  assert.equal(find('Cash: 10$')[0].category, 'Cash');
  assert.equal(find('Changing USD to bs: 20$')[0].category, 'Fees & admin');
  assert.equal(find('Zinli: 25$')[0].kind, 'transfer_out');
  assert.equal(find('1200 USD')[0].kind, 'income');
  assert.equal(find('Food out: 23$ + 12$')[0].category, 'Dining out');
  assert.equal(find('Rent: 211$')[0].category, 'Housing & utilities');
  assert.ok(find('Mystery thing: 9$')[0].flags.includes('needs_review'));
});

test('country switches at the AR marker', () => {
  assert.equal(find('Zinli: 25$')[0].country, 'VE');
  assert.equal(find('Food:72$')[0].country, 'AR');
});

test('unreadable lines are reported, never dropped silently', () => {
  assert.equal(find('Food: ??$').length, 0);
  assert.ok(issues.some((i) => !i.info && i.line === 'Food: ??$'));
});
