// GET /export (AC-17) against the in-memory store. Rows are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS } from '@smart-finances/contracts/fields';
import { ROUTES } from '@smart-finances/contracts/routes';
import { createMemoryStore } from '../src/store/memory.mjs';
import { ovrKey, txnKey } from '../src/store/keys.mjs';
import { createReadHandler } from '../src/handlers/read.mjs';
import { httpEvent } from './fixtures/http.mjs';

const A = 'person-a';
const B = 'person-b';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');

const row = (id, date, over = {}) => ({
  id,
  date,
  date_precision: 'day',
  kind: 'expense',
  amount: -1234,
  currency: 'ARS',
  category: 'Uncategorized',
  merchant: '',
  description_raw: 'made-up shop',
  source: 'mercadopago',
  source_ref: `ref-${id}`,
  country: 'AR',
  flags: [],
  import_batch: 'mercadopago:abc',
  ...over,
});

// RFC 4180 lines of a small, known shape: no newlines inside cells in these fixtures.
function parseCsv(text) {
  const cells = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quoted && c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const [head, ...rows] = text.trimEnd().split('\n').map(cells);
  return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))) };
}

async function world() {
  const store = createMemoryStore();
  const put = (sub, t) => store.put({ ...txnKey(sub, t.date, t.id), ...t, period: t.date.slice(0, 7), import_id: 'imp' });
  const handler = createReadHandler({ store, now: () => T0 });
  const get = async (sub) => handler(httpEvent(sub, 'GET /export'));
  return { store, put, get };
}

test('T-API-11 export is text/csv with the schema columns in order and every row of the person, review choices applied', async () => {
  const w = await world();
  const a = row('000000000000000a', '2026-03-01', { flags: ['needs_review', 'summed'] });
  const b = row('000000000000000b', '2025-12-31', { amount: 500000, kind: 'income', category: 'Income', source: 'notion', date_precision: 'month' });
  await w.put(A, a);
  await w.put(A, b);
  await w.put(B, row('000000000000000c', '2026-03-01'));
  await w.store.put({ ...ovrKey(A, a.date, a.id), date: a.date, month: '2026-03', category: 'Groceries', approved: true, updated_at: 'x' });

  const res = await w.get(A);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/csv/);
  assert.ok(ROUTES['GET /export'].reply.safeParse(res.body).success);
  const { head, rows } = parseCsv(res.body);
  assert.deepEqual(head, FIELDS);
  assert.deepEqual(rows.map((r) => r.id), [b.id, a.id], 'oldest first, only this person');
  assert.equal(rows[1].category, 'Groceries', 'the review choice applies');
  assert.equal(rows[1].amount, '-12.34');
  assert.equal(rows[1].flags, 'needs_review|summed');
  assert.equal(rows[0].amount, '5000.00');

  const empty = await w.get('person-c');
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.body, `${FIELDS.join(',')}\n`);
  assert.equal((await w.get(null)).statusCode, 401);
});

test('T-API-11 formula-like text gets a leading quote in every text column; amounts never do', async () => {
  const w = await world();
  const hostile = row('000000000000000d', '2026-04-01', {
    amount: -500,
    merchant: '=HYPERLINK("x")',
    description_raw: '+cmd',
    source_ref: '-1+1',
    category: '@SUM(A1)',
    country: '\tAR',
    currency: 'ARS',
    import_batch: '\rbatch',
    flags: ['=bad'],
  });
  await w.put(A, hostile);
  const { rows } = parseCsv((await w.get(A)).body);
  const [r] = rows;
  assert.equal(r.merchant, `'=HYPERLINK("x")`);
  assert.equal(r.description_raw, "'+cmd");
  assert.equal(r.source_ref, "'-1+1");
  assert.equal(r.category, "'@SUM(A1)");
  assert.equal(r.country, "'\tAR");
  assert.equal(r.import_batch, "'\rbatch");
  assert.equal(r.flags, "'=bad");
  assert.equal(r.amount, '-5.00', 'a negative amount stays a number');
  assert.equal(r.currency, 'ARS');
});
