// The parser handler: S3 Object Created events and reconcile invokes, against the in-memory
// store. Every file here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store/memory.mjs';
import { PREFIX } from '../src/store/keys.mjs';
import { createUlid } from '../src/store/ulid.mjs';
import { createImport, getImport, getPointer } from '../src/store/imports.mjs';
import { createParserHandler, objectCreated } from '../src/handlers/parser.mjs';
import { makeXlsx, serial } from './fixtures/xlsx.mjs';

const A = 'person-a';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const MIN = 60_000;

const csv = (lines) => ['date,description,amount,currency,account', ...lines].join('\n');
const MP_HEADER = 'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID';
const mpRow = (date, id, desc, credit, debit, balance) => [date, id, desc, credit, debit, '0.00', '0.00', '0.00', 'available_money', date, '', '', balance, '', ''].join(';');
const mpReport = [
  MP_HEADER,
  mpRow('2026-05-01T00:00:00.000-03:00', '', '', '1000.00', '0.00', '1000.00'),
  mpRow('2026-05-02T10:00:02.000-03:00', '111', 'payment', '0.00', '250.00', '750.00'),
  mpRow('2026-06-01T08:00:00.000-03:00', '555', 'payment', '0.00', '50.00', '700.00'),
  ';;;700.00;0.00;0.00;0.00;0.00;;;;;0.00;;',
].join('\n');
function workbook() {
  const t = { B4: 'Date', C4: 'Amount', D4: 'Description', E4: 'Category', G4: 'Date', H4: 'Amount', I4: 'Description', J4: 'Category' };
  [[serial(2030, 8, 3), 380, '$RENT', 'Home'], [serial(2030, 8, 6), 20, 'Food', 'Food']].forEach(([d, a, desc, c], i) => Object.assign(t, { [`B${5 + i}`]: d, [`C${5 + i}`]: a, [`D${5 + i}`]: desc, [`E${5 + i}`]: c }));
  return makeXlsx({ Summary: { E26: 400, K26: 0, B27: 'Home', B28: 'Food' }, Transactions: t });
}

function setup(over = {}) {
  const store = createMemoryStore();
  const ulid = createUlid();
  let clock = T0;
  const handler = createParserHandler({ store, now: () => clock, ...over });
  async function upload(source, file_name, body, { at = T0 } = {}) {
    const r = await createImport(store, A, { source, file_name, size: Buffer.byteLength(body), now: at, ulid });
    store.putObject(r.s3_key, body);
    return r;
  }
  const event = (key, time = new Date(T0 + MIN).toISOString()) => objectCreated(key, time);
  const rows = () => [...store.items.values()].filter((i) => i.sk.startsWith(PREFIX.TXN));
  const record = (id) => getImport(store, A, id);
  const setClock = (t) => { clock = t; };
  return { store, handler, upload, event, rows, record, setClock };
}


test('T-IMP-6 a file with some bad rows imports the rest and records counts and every skipped row', async () => {
  const h = setup();
  const r = await h.upload('csv', 'demo.csv', csv(['2026-03-01,A,-1.00,ARS,acc', '2026-13-01,BAD,-1.00,ARS,acc', '2026-03-02,B,2.00,ARS,acc', '2026-03-03,C,lots,ARS,acc']));
  await h.handler(h.event(r.s3_key));
  const rec = await h.record(r.import_id);
  assert.equal(rec.status, 'done');
  assert.equal(rec.period, 'log');
  assert.deepEqual(rec.counts, { added: 2, updated: 0, removed: 0, skipped: 2 });
  assert.deepEqual(rec.skipped.map((s) => s.where), ['demo.csv#row 2', 'demo.csv#row 4']);
  assert.ok(rec.skipped.every((s) => s.reason.length > 0 && !s.where.includes('BAD')));
  assert.match(rec.content_hash, /^csv:[0-9a-f]{12}$/);
  assert.equal(h.rows().length, 2);
  assert.ok(h.rows().every((i) => i.import_id === r.import_id && i.period === 'log' && i.pk === `U#${A}`));
  assert.equal((await getPointer(h.store, A, 'csv', 'log')).active_import, r.import_id);
});

test('T-IMP-6 every source imports through the same path', async () => {
  const h = setup();
  const mp = await h.upload('mercadopago', 'may.csv', mpReport);
  const notion = await h.upload('notion', 'log.md', 'Nov - 2030\n\n- Food: 18$\n- Taxi 10$\n');
  const excel = await h.upload('excel', 'Budget AUG_2030.xlsx', workbook());
  for (const r of [mp, notion, excel]) await h.handler(h.event(r.s3_key));
  const [m, n, x] = await Promise.all([mp, notion, excel].map((r) => h.record(r.import_id)));
  assert.deepEqual([m.status, m.period, n.status, n.period, x.status, x.period], ['done', '2026-05', 'done', 'log', 'done', '2030-08']);
  // The payments report's row in June is named as left out, not dropped silently.
  assert.equal(m.skipped.length, 1);
  assert.equal(m.skipped[0].where, 'file');
  assert.equal(m.checks.month, '2026-05');
  assert.ok(h.rows().some((i) => i.source === 'excel') && h.rows().some((i) => i.source === 'notion'));
});

test('T-IMP-7 content no importer can read stores no rows and records why', async () => {
  const h = setup();
  const throwing = await h.upload('mercadopago', 'x.csv', 'just,some,text\n1,2,3\n');
  const garbage = await h.upload('notion', 'x.md', 'hello\nworld\n');
  const notZip = await h.upload('excel', 'b_Mar_2026.xlsx', 'not a zip');
  for (const r of [throwing, garbage, notZip]) await h.handler(h.event(r.s3_key));
  for (const r of [throwing, garbage, notZip]) {
    const rec = await h.record(r.import_id);
    assert.equal(rec.status, 'failed', r.source);
    assert.ok(rec.error.code && rec.error.message, JSON.stringify(rec.error));
    assert.ok(rec.finished_at);
  }
  assert.equal((await h.record(garbage.import_id)).error.code, 'unknown_content');
  assert.equal(h.rows().length, 0);
  assert.equal(await getPointer(h.store, A, 'mercadopago', '2026-05'), undefined);
});

test('T-IMP-7 more than 2,000 unreadable rows fail the file as a whole', async () => {
  const h = setup();
  const bad = Array.from({ length: 2001 }, (_, i) => `2026-03-01,ROW${i},nope,ARS,acc`);
  const r = await h.upload('csv', 'big.csv', csv(['2026-03-01,GOOD,-1.00,ARS,acc', ...bad]));
  await h.handler(h.event(r.s3_key));
  const rec = await h.record(r.import_id);
  assert.deepEqual([rec.status, rec.error.code], ['failed', 'too_many_bad_rows']);
  assert.equal(h.rows().length, 0);
  // 2,000 exactly is still imported.
  const ok = await h.upload('csv', 'ok.csv', csv(['2026-03-01,GOOD,-1.00,ARS,acc', ...bad.slice(1)]));
  await h.handler(h.event(ok.s3_key));
  assert.equal((await h.record(ok.import_id)).status, 'done');
});

test('T-IMP-7 an object with no import record is deleted and nothing is written', async () => {
  const h = setup();
  const key = `uploads/${A}/01NOSUCHIMPORT0000000000000`;
  h.store.putObject(key, csv(['2026-03-01,A,-1.00,ARS,acc']));
  const before = h.store.items.size;
  await h.handler(h.event(key));
  assert.equal(h.store.objects.has(key), false);
  assert.equal(h.store.items.size, before);
});

test('T-IMP-7 a key that is not uploads/<sub>/<id>, or names another person, writes nothing', async () => {
  const h = setup();
  const r = await h.upload('csv', 'a.csv', csv(['2026-03-01,A,-1.00,ARS,acc']));
  const before = JSON.stringify([...h.store.items.values()]);
  for (const key of ['uploads/x', `other/${A}/${r.import_id}`, `uploads/person-b/${r.import_id}`, `uploads/${A}/${r.import_id}/extra`]) {
    h.store.putObject(key, 'x');
    await h.handler(h.event(key));
  }
  assert.equal(JSON.stringify([...h.store.items.values()]), before);
});

test('T-IMP-7 a file that arrives after its form expired fails', async () => {
  const h = setup();
  const r = await h.upload('csv', 'a.csv', csv(['2026-03-01,A,-1.00,ARS,acc']));
  h.setClock(T0 + 20 * MIN);
  await h.handler(h.event(r.s3_key, new Date(T0 + 20 * MIN).toISOString()));
  assert.equal((await h.record(r.import_id)).error.code, 'form_expired');
  assert.equal(h.rows().length, 0);
});

test('T-IMP-8 a one-month result with a row dated outside its month fails with no rows written', async () => {
  const leaky = {
    mercadopago: () => ({ transactions: [row('a', '2026-05-02', 'mercadopago'), row('b', '2026-06-01', 'mercadopago')], check: { month: '2026-05', rowsOutsideMonth: 0 } }),
    excel: () => ({ transactions: [row('c', '2030-08-02', 'excel'), row('d', '2030-07-31', 'excel')], issues: [], check: { month: '2030-08' } }),
  };
  const h = setup({ importers: leaky });
  const mp = await h.upload('mercadopago', 'may.csv', 'anything');
  const xl = await h.upload('excel', 'b_Aug_2030.xlsx', 'anything');
  for (const r of [mp, xl]) await h.handler(h.event(r.s3_key));
  for (const r of [mp, xl]) assert.deepEqual([(await h.record(r.import_id)).status, (await h.record(r.import_id)).error.code], ['failed', 'row_outside_month']);
  assert.equal(h.rows().length, 0);
});

test('T-IMP-8 the real importers never trip the month check on their synthetic fixtures', async () => {
  const h = setup();
  const mp = await h.upload('mercadopago', 'may.csv', mpReport);
  const xl = await h.upload('excel', 'Budget AUG_2030.xlsx', workbook());
  for (const r of [mp, xl]) await h.handler(h.event(r.s3_key));
  for (const r of [mp, xl]) assert.equal((await h.record(r.import_id)).status, 'done');
});

test('T-IMP-6 a duplicate event of a finished import is ignored and changes nothing', async () => {
  const h = setup();
  const r = await h.upload('csv', 'a.csv', csv(['2026-03-01,A,-1.00,ARS,acc']));
  await h.handler(h.event(r.s3_key));
  const before = JSON.stringify([...h.store.items.values()]);
  await h.handler(h.event(r.s3_key));
  assert.equal(JSON.stringify([...h.store.items.values()]), before);
});

test('T-IMP-6 reconcile mode re-parses the active file from storage', async () => {
  const h = setup();
  const r = await h.upload('csv', 'a.csv', csv(['2026-03-01,A,-1.00,ARS,acc', '2026-03-02,B,-2.00,ARS,acc']));
  await h.handler(h.event(r.s3_key));
  // Someone removed a stored row; a repair-like record holding the lock reconciles it back.
  const victim = h.rows()[0];
  await h.store.remove(victim);
  const repair = await createImport(h.store, A, { source: 'csv', file_name: 'a.csv', size: 1, now: T0 + 2 * MIN });
  await h.store.put({ ...repair, kind: 'repair', status: 'reconciling', period: 'log' });
  await takeLockFor(h.store, repair.import_id);
  await h.handler({ sub: A, import_id: repair.import_id });
  assert.equal(h.rows().length, 2);
  assert.equal((await h.record(repair.import_id)).status, 'done');
});

// Test helper: give a record the period lock the way the write handler will for undo and repair.
async function takeLockFor(store, id) {
  const rec = await getImport(store, A, id);
  const p = await getPointer(store, A, rec.source, rec.period);
  await store.put({ ...p, lock_import: id, lock_until: new Date(T0 + 30 * MIN).toISOString(), rev: p.rev + 1 });
}

function row(id, date, source) {
  return { id, date, date_precision: 'day', kind: 'expense', amount: -100, currency: 'ARS', category: 'Groceries', merchant: '', description_raw: id, source, source_ref: `f#${id}`, country: 'AR', flags: [], import_batch: 'b' };
}


// ---- SF-28 review fixes ----
test('T-IMP-7 a payments report whose period cannot be read fails instead of crashing', async () => {
  const h = setup();
  const report = mpReport.replaceAll('2026-05-0', '2026-5x-0');
  const r = await h.upload('mercadopago', 'x.csv', report);
  await h.handler(h.event(r.s3_key));
  const rec = await h.record(r.import_id);
  assert.deepEqual([rec.status, rec.error.code], ['failed', 'unreadable']);
  assert.equal(h.rows().length, 0);
});

test('T-IMP-7 a file with no rows at all fails and leaves the stored rows alone', async () => {
  const h = setup();
  await h.handler(h.event((await h.upload('csv', 'a.csv', csv(['2026-03-01,A,-1.00,ARS,acc']))).s3_key));
  const empty = await h.upload('csv', 'b.csv', csv([]), { at: T0 });
  await h.handler(h.event(empty.s3_key));
  assert.deepEqual([(await h.record(empty.import_id)).status, (await h.record(empty.import_id)).error.code], ['failed', 'no_rows']);
  assert.equal(h.rows().length, 1);
});

test('T-IMP-7 a file that is not the size the form was asked for fails', async () => {
  const h = setup();
  const r = await h.upload('csv', 'a.csv', csv(['2026-03-01,A,-1.00,ARS,acc']));
  h.store.putObject(r.s3_key, csv(['2026-03-01,A,-1.00,ARS,acc', '2026-03-02,B,-1.00,ARS,acc']));
  await h.handler(h.event(r.s3_key));
  assert.equal((await h.record(r.import_id)).error.code, 'size_mismatch');
  assert.equal(h.rows().length, 0);
});
