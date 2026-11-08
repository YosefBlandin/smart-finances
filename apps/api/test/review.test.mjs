// GET /review and PUT /transactions/{id}/review (D-8) against the in-memory store. Rows and files
// are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '@smart-finances/contracts/routes';
import { createMemoryStore } from '../src/store/memory.mjs';
import { erasedKey, ovrKey, PREFIX, txnKey } from '../src/store/keys.mjs';
import { createUlid } from '../src/store/ulid.mjs';
import { createImport } from '../src/store/imports.mjs';
import { createParserHandler, objectCreated } from '../src/handlers/parser.mjs';
import { createReadHandler } from '../src/handlers/read.mjs';
import { createWriteHandler } from '../src/handlers/write.mjs';
import { httpEvent } from './fixtures/http.mjs';

const A = 'person-a';
const B = 'person-b';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const MIN = 60_000;

let n = 0;
const row = (date, over = {}) => {
  n += 1;
  return {
    id: n.toString(16).padStart(16, '0'),
    date,
    date_precision: 'day',
    kind: 'expense',
    amount: -100 * n,
    currency: 'ARS',
    category: 'Uncategorized',
    merchant: '',
    description_raw: `made-up ${n}`,
    source: 'mercadopago',
    source_ref: `r${n}`,
    country: 'AR',
    flags: [],
    import_batch: 'b',
    ...over,
  };
};

function world() {
  const store = createMemoryStore();
  let clock = T0;
  const now = () => clock;
  const read = createReadHandler({ store, now });
  const write = createWriteHandler({ store, now });
  const call = async (handler, sub, routeKey, opts) => {
    const res = await handler(httpEvent(sub, routeKey, opts));
    const body = JSON.parse(res.body);
    if (res.statusCode < 300) assert.ok(ROUTES[routeKey].reply.safeParse(body).success, `${routeKey} reply parses`);
    return { status: res.statusCode, body };
  };
  return {
    store,
    tick: (ms) => (clock += ms),
    put: (sub, t) => store.put({ ...txnKey(sub, t.date, t.id), ...t, period: t.date.slice(0, 7), import_id: 'imp' }),
    review: (sub) => call(read, sub, 'GET /review'),
    choose: (sub, id, body) => call(write, sub, 'PUT /transactions/{id}/review', { pathParameters: { id }, body }),
    list: (sub, from, to = from) => call(read, sub, 'GET /transactions', { queryStringParameters: { from, to } }),
  };
}

test('T-API-8 GET /review lists every row with needs_review or possible_duplicate that no approval hides, with reasons', async () => {
  const w = world();
  const plain = row('2026-05-01');
  const needs = row('2026-05-02', { flags: ['needs_review', 'summed'] });
  const dup = row('2026-04-03', { flags: ['possible_duplicate'], source: 'excel' });
  const both = row('2026-06-04', { flags: ['possible_duplicate', 'needs_review'] });
  const approved = row('2026-05-05', { flags: ['needs_review'] });
  const recat = row('2026-05-06', { flags: ['needs_review'] });
  for (const t of [plain, needs, dup, both, approved, recat]) await w.put(A, t);
  await w.put(B, row('2026-05-01', { flags: ['needs_review'] }));
  await w.store.put({ ...ovrKey(A, approved.date, approved.id), date: approved.date, month: '2026-05', approved: true, updated_at: 'x' });
  await w.store.put({ ...ovrKey(A, recat.date, recat.id), date: recat.date, month: '2026-05', category: 'Groceries', approved: false, updated_at: 'x' });

  const res = await w.review(A);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i) => [i.id, i.reasons]), [
    [dup.id, ['possible_duplicate']],
    [needs.id, ['needs_review']],
    [recat.id, ['needs_review']],
    [both.id, ['needs_review', 'possible_duplicate']],
  ]);
  assert.equal(res.body.items.find((i) => i.id === recat.id).category, 'Groceries', 'the choice applies');
  for (const item of res.body.items) for (const key of ['pk', 'sk', 'review', 'period', 'import_id']) assert.equal(key in item, false, key);
  assert.equal((await w.review(B)).body.items.length, 1);
  assert.equal((await w.review(null)).status, 401);
});

test('T-API-10 PUT review: a missing row is not_found, a notes log or workbook row is source_file_only, an unknown category or bad body is bad_request', async () => {
  const w = world();
  const mp = row('2026-05-01', { flags: ['needs_review'] });
  const log = row('2026-05-01', { source: 'notion', date_precision: 'month' });
  const book = row('2026-05-02', { source: 'excel' });
  const generic = row('2026-05-03', { source: 'csv' });
  for (const t of [mp, log, book, generic]) await w.put(A, t);

  const missing = await w.choose(A, 'ffffffffffffffff', { date: '2026-05-01', approved: true });
  assert.deepEqual([missing.status, missing.body.error.code], [404, 'not_found']);
  const wrongDate = await w.choose(A, mp.id, { date: '2026-05-02', approved: true });
  assert.deepEqual([wrongDate.status, wrongDate.body.error.code], [404, 'not_found']);
  const otherPerson = await w.choose(B, mp.id, { date: mp.date, approved: true });
  assert.deepEqual([otherPerson.status, otherPerson.body.error.code], [404, 'not_found']);
  for (const t of [log, book, generic]) {
    const res = await w.choose(A, t.id, { date: t.date, category: 'Groceries' });
    assert.deepEqual([res.status, res.body.error.code], [409, 'source_file_only'], t.source);
  }
  for (const body of [{ date: mp.date, category: 'Snacks' }, { date: '2026-5-01', approved: true }, { approved: true }, { date: mp.date, approved: 'yes' }, 'not json']) {
    const res = await w.choose(A, mp.id, body);
    assert.deepEqual([res.status, res.body.error.code], [400, 'bad_request'], JSON.stringify(body));
  }
  for (const id of ['a#b', 'a/b', '']) {
    const res = await w.choose(A, id, { date: mp.date, approved: true });
    assert.ok([400, 404].includes(res.status), id);
  }
  assert.equal([...w.store.items.keys()].filter((k) => k.includes(PREFIX.OVR)).length, 0, 'nothing stored');
});

test('T-API-10 PUT review stores the choice apart, keeps fields left out, and approval clears the reasons', async () => {
  const w = world();
  const mp = row('2026-05-01', { flags: ['needs_review'] });
  await w.put(A, mp);
  const first = await w.choose(A, mp.id, { date: mp.date, category: 'Dining out' });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { review: { reasons: ['needs_review'], category_override: 'Dining out', approved: false, updated_at: new Date(T0).toISOString() } });
  w.tick(MIN);
  const second = await w.choose(A, mp.id, { date: mp.date, approved: true });
  assert.deepEqual(second.body, { review: { reasons: [], category_override: 'Dining out', approved: true, updated_at: new Date(T0 + MIN).toISOString() } });
  const stored = await w.store.get(ovrKey(A, mp.date, mp.id));
  assert.deepEqual([stored.category, stored.approved, stored.month, stored.date], ['Dining out', true, '2026-05', mp.date]);
  assert.equal((await w.store.get(txnKey(A, mp.date, mp.id))).category, 'Uncategorized', 'the row itself is untouched');
  const listed = (await w.list(A, '2026-05')).body.items[0];
  assert.equal(listed.category, 'Dining out');
  assert.deepEqual(listed.review, second.body.review);
  assert.deepEqual((await w.review(A)).body.items, []);

  // In the erase window the choice is refused, so nothing outlives the erase.
  await w.store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
  const refused = await w.choose(A, mp.id, { date: mp.date, approved: false });
  assert.deepEqual([refused.status, refused.body.error.code], [409, 'conflict']);
  assert.equal((await w.store.get(ovrKey(A, mp.date, mp.id))).approved, true);
});

test('T-API-9 an approval and a category change on a payments report row survive a re-import of the same source', async () => {
  const w = world();
  const HEADER = 'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID';
  const mpRow = (date, id, desc, credit, debit, balance) => [date, id, desc, credit, debit, '0.00', '0.00', '0.00', 'available_money', date, '', '', balance, '', ''].join(';');
  const report = (extra) => [
    HEADER,
    mpRow('2026-05-01T00:00:00.000-03:00', '', '', '1000.00', '0.00', '1000.00'),
    mpRow('2026-05-02T10:00:02.000-03:00', '111', 'payment', '0.00', '250.00', '750.00'),
    ...extra,
    ';;;700.00;0.00;0.00;0.00;0.00;;;;;0.00;;',
  ].join('\n');
  const ulid = createUlid();
  const parser = createParserHandler({ store: w.store, now: () => T0 + 2 * MIN });
  const upload = async (body, at) => {
    const r = await createImport(w.store, A, { source: 'mercadopago', file_name: 'may.csv', size: Buffer.byteLength(body), now: at, ulid });
    w.store.putObject(r.s3_key, body);
    await parser(objectCreated(r.s3_key, new Date(at + MIN).toISOString()));
    return r;
  };
  await upload(report([]), T0);
  const [first] = (await w.list(A, '2026-05')).body.items;
  assert.ok(first, 'the payment was imported');
  assert.equal((await w.choose(A, first.id, { date: first.date, category: 'Groceries', approved: true })).status, 200);

  // A corrected report of the same month: one more operation.
  await upload(report([mpRow('2026-05-03T09:00:00.000-03:00', '222', 'payment', '0.00', '50.00', '700.00')]), T0 + MIN);
  const items = (await w.list(A, '2026-05')).body.items;
  assert.equal(items.length, 2);
  const again = items.find((i) => i.id === first.id);
  assert.equal(again.category, 'Groceries');
  assert.equal(again.review.approved, true);
  assert.deepEqual(again.review.reasons, []);
});

// Every category an importer can set, read from the importers' own sources, must be in the shared
// list the web shows and PUT review accepts (D-39, D-44).
test('T-API-10 every category an importer can emit is in the contracts list', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { CATEGORIES } = await import('@smart-finances/contracts/categories');
  const src = (name) => readFileSync(new URL(`../src/ingest/${name}`, import.meta.url), 'utf8');
  const quoted = (text, re) => [...text.matchAll(re)].map((m) => m[1]);
  const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
  const emitted = new Set([
    ...quoted(src('categories.mjs'), /\],?\s*'([^']+)'\]/g),
    ...quoted(src('categories.mjs'), /\/[a-z]*, '([^']+)'\]/g),
    // Every inline category literal in every importer file.
    ...readdirSync(new URL('../src/ingest/', import.meta.url)).filter((f) => f.endsWith('.mjs')).flatMap((f) => quoted(src(f), /category: '([^']+)'/g)),
    ...quoted(between(src('mercadopago.mjs'), 'function categoryFor', '\n}\n'), /return '([^']+)'/g),
    ...quoted(between(src('excel.mjs'), 'const SHEET_CATEGORIES = {', '};'), /:\s*'([^']+)'/g),
    ...quoted(src('excel.mjs'), /\?\? '([^']+)'/g),
  ]);
  assert.ok(emitted.size >= 20, `found ${emitted.size} categories in the importers`);
  for (const name of ['Interest', 'Refunds', 'Shopping', 'Income', 'Loans', 'Transfers', 'Pets', 'Uncategorized', 'Groceries']) assert.ok(emitted.has(name), `the scan finds ${name}`);
  const missing = [...emitted].filter((c) => !CATEGORIES.includes(c));
  assert.deepEqual(missing, []);
  assert.equal(CATEGORIES.at(-1), 'Uncategorized', 'the fallback stays last');
});

test('T-API-10 a choice written between the read and the write is re-read, so a field left out keeps its value', async () => {
  const w = world();
  const mp = row('2026-05-01', { flags: ['needs_review'] });
  await w.put(A, mp);
  await w.choose(A, mp.id, { date: mp.date, category: 'Dining out' });
  // Another write lands just after this request first reads the choice.
  const realGet = w.store.get.bind(w.store);
  let raced = false;
  w.store.get = async (key, opts) => {
    const value = await realGet(key, opts);
    if (!raced && key.sk.startsWith('OVR#')) {
      raced = true;
      await w.store.put({ ...value, category: 'Groceries', updated_at: 'later' });
    }
    return value;
  };
  w.tick(MIN);
  const res = await w.choose(A, mp.id, { date: mp.date, approved: true });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.review.category_override, res.body.review.approved], ['Groceries', true]);
});

test('T-API-10 a choice that keeps changing under every try answers conflict with a try-again message, not the erase one', async () => {
  const w = world();
  const mp = row('2026-05-01', { flags: ['needs_review'] });
  await w.put(A, mp);
  await w.choose(A, mp.id, { date: mp.date, category: 'Dining out' });
  // Another writer lands after every read of the choice.
  const realGet = w.store.get.bind(w.store);
  let writes = 0;
  w.store.get = async (key, opts) => {
    const value = await realGet(key, opts);
    if (key.sk.startsWith('OVR#')) await w.store.put({ ...value, updated_at: `later-${(writes += 1)}` });
    return value;
  };
  w.tick(MIN);
  const res = await w.choose(A, mp.id, { date: mp.date, approved: true });
  assert.deepEqual([res.status, res.body.error.code], [409, 'conflict']);
  assert.doesNotMatch(res.body.error.message, /deleted/);
  assert.match(res.body.error.message, /try again/);
  assert.equal(writes, 3, 'three tries');
});
