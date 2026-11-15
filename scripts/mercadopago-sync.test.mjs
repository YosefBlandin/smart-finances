// Runs sync against a fake Mercado Pago, an in-memory folder and a fake clock. Report data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseReleaseReport } from '../apps/api/src/ingest/mercadopago.mjs';
import {
  HASH_KEY_FILE,
  cleanValue,
  enrichReport,
  findReport,
  holdsFullMonth,
  lastFullMonth,
  loadHashKey,
  loadToken,
  mercadoPagoApi,
  monthBounds,
  planSync,
  recipientKey,
  reportState,
  searchPayments,
  sync,
  utcMidnightAR,
} from './mercadopago-sync.mjs';

const HEADER = 'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID';
const row = (date, id, desc, credit, debit, balance) =>
  [date, id, desc, credit, debit, '0.00', '0.00', '0.00', 'available_money', date, '', '', balance, '', ''].join(';');
const csv = (ym) =>
  [
    HEADER,
    row(`${ym}-01T00:00:00.000-03:00`, '', '', '100.00', '0.00', '100.00'),
    row(`${ym}-02T10:00:00.000-03:00`, '1', 'payment', '0.00', '40.00', '60.00'),
    ';;;60.00;0.00;0.00;0.00;0.00;;;;;0.00;;',
  ].join('\n');

// A download made after the config change (D-19): the 15 columns plus the payer name and payout account columns.
const RAW_HEADER = `${HEADER};PAYER_NAME;PAYOUT_BANK_ACCOUNT_NUMBER`;
const rawRow = (date, id, desc, credit, debit, balance, payer = '', account = '') => `${row(date, id, desc, credit, debit, balance)};${payer};${account}`;
const rawCsv = (ym) =>
  [
    RAW_HEADER,
    rawRow(`${ym}-01T00:00:00.000-03:00`, '', '', '100.00', '0.00', '100.00'),
    rawRow(`${ym}-02T10:00:00.000-03:00`, '1', 'payment', '0.00', '40.00', '60.00', 'Owner Example'),
    rawRow(`${ym}-03T10:00:00.000-03:00`, '2', 'payment', '15.00', '0.00', '75.00', 'Ana Example'),
    ';;;75.00;0.00;0.00;0.00;0.00;;;;;0.00;;;;',
  ].join('\n');
const HASH_KEY = Buffer.alloc(32, 7);
// A month sync saved after enrichment; only these count as fully synced (D-16).
const enrichedCsv = (ym) => enrichReport(csv(ym), { payments: {}, hashKey: HASH_KEY });

const NOW = Date.parse('2026-11-14T15:00:00Z');
const LEGACY_PARTIAL_OCT = 'reserve-release-1-manual-2026-10-20-162903.csv';

function memoryFolder(files = {}) {
  const store = { ...files };
  return {
    store,
    read: () =>
      Object.keys(store)
        .filter((n) => !n.includes('/') && n.endsWith('.csv'))
        .sort()
        .map((name) => ({ name, text: store[name] })),
    write(name, buf) {
      store[name] = buf.toString('utf8');
    },
    setAside(name, sub) {
      store[`${sub}/${name}`] = store[name];
      delete store[name];
    },
    hashKey: () => HASH_KEY,
  };
}

function fakeClock(start = NOW) {
  let t = start;
  return { clock: () => t, sleep: async (ms) => void (t += ms) };
}

const ME = 4242;
const LIVE_COLUMNS = HEADER.split(';');
const D19 = ['PAYER_NAME', 'PAYOUT_BANK_ACCOUNT_NUMBER'];
// The payments search: one shop payment as payer, one transfer received as collector. `search` overrides the reply.
const defaultSearch = async (p) => {
  const results = p.includes(`payer.id=${ME}`)
    ? [{ id: 1, collector: { id: 7777001 }, point_of_interaction: { transaction_data: { commerce: { name: 'Made-up Cafe', mcc: '5812' } } } }]
    : [{ id: 2, payer: { id: 8888002, email: 'ana@example.com' } }];
  return { status: 200, data: { paging: { total: results.length }, results }, text: '' };
};

// Reports turn "processed" after `readyAfter` list calls; `serve` picks the CSV each download gets; `columns` is the
// report config; `search` answers the payments searches.
function fakeMercadoPago({ clock, readyAfter = 1, never = false, existing = [], serve = rawCsv, createStatuses = [], columns = [...LIVE_COLUMNS, ...D19], search = defaultSearch }) {
  const reports = [...existing];
  const calls = { create: 0, list: 0, config: 0, download: [], get: [] };
  return {
    reports,
    calls,
    async config() {
      calls.config += 1;
      return { status: 200, data: { columns: columns.map((key) => ({ key })) }, text: '' };
    },
    async get(p, opts) {
      calls.get.push(p);
      if (p === '/users/me') return { status: 200, data: { id: ME }, text: '' };
      return search(p, opts);
    },
    async create(ym) {
      calls.create += 1;
      const status = createStatuses.shift() ?? 202;
      if (status !== 202) return { status, data: null, text: '' };
      const { first, last } = monthBounds(ym);
      reports.push({
        id: reports.length + 1,
        ym,
        begin_date: utcMidnightAR(first),
        end_date: `${last}T23:59:59-03:00`, // the API stretches the end to the end of that day
        status: 'pending',
        left: readyAfter,
      });
      return { status: 202, data: {}, text: '{}' };
    },
    async list() {
      calls.list += 1;
      for (const r of reports) {
        if (r.status !== 'pending' || never) continue;
        r.left -= 1;
        if (r.left <= 0) Object.assign(r, { status: 'processed', generation_date: new Date(clock()).toISOString(), file_name: `reserve-release-1-manual-${r.id}.csv` });
      }
      return { status: 200, data: reports.map(({ left, ym, ...r }) => r), text: '' };
    },
    async download(name) {
      calls.download.push(name);
      const r = reports.find((x) => x.file_name === name);
      return Buffer.from(serve(r.ym ?? r.begin_date.slice(0, 7)));
    },
  };
}

const quiet = () => {};

// ---- planning ----

test('a full month is skipped, a partial one is fetched again and replaces the old file', () => {
  const plan = planSync({
    files: [
      { name: 'release-2026-08.csv', text: enrichedCsv('2026-08') },
      { name: 'reserve-release-1-manual-2026-10-20-160928.csv', text: enrichedCsv('2026-09') }, // made after Sep ended
      { name: LEGACY_PARTIAL_OCT, text: csv('2026-10') }, // made on Oct 20
    ],
    nowMs: NOW,
  });
  assert.equal(plan.start, '2026-08');
  assert.equal(plan.end, '2026-10');
  assert.deepEqual(plan.months, ['2026-10']);
  assert.deepEqual(plan.replaces['2026-10'], [LEGACY_PARTIAL_OCT]);
});

test('gaps in the range are fetched; --from widens it; unreadable files are listed', () => {
  const plan = planSync({
    files: [
      { name: 'release-2026-07.csv', text: enrichedCsv('2026-07') },
      { name: 'release-2026-09.csv', text: enrichedCsv('2026-09') },
      { name: 'broken.csv', text: 'not a report' },
    ],
    from: '2026-05',
    nowMs: NOW,
  });
  assert.deepEqual(plan.months, ['2026-05', '2026-06', '2026-08', '2026-10']);
  assert.deepEqual(plan.unreadable.map((u) => u.name), ['broken.csv']);
});

test('a month that has not ended, a bad month and an empty folder are refused', () => {
  assert.throws(() => planSync({ files: [], from: '2026-10', to: '2026-11', nowMs: NOW }), /has not ended yet/);
  assert.throws(() => planSync({ files: [], from: '2026-13', nowMs: NOW }), /--from must be YYYY-MM/);
  assert.throws(() => planSync({ files: [], nowMs: NOW }), /Pass --from/);
});

test('the last full month follows the Argentine calendar', () => {
  assert.equal(lastFullMonth(Date.parse('2026-12-01T02:59:00Z')), '2026-10'); // still Nov 30 in Argentina
  assert.equal(lastFullMonth(Date.parse('2026-12-01T03:00:00Z')), '2026-11');
});

test('findReport matches the month by Argentine day and skips reports made before it ended', () => {
  const base = { begin_date: '2026-10-01T03:00:00Z', end_date: '2026-10-31T23:59:59.000-03:00' };
  const early = { ...base, id: 1, status: 'processed', generation_date: '2026-10-20T19:29:03Z' };
  const pending = { ...base, id: 2, status: 'pending' };
  const late = { ...base, id: 3, status: 'processed', generation_date: '2026-11-02T10:00:00Z' };
  const other = { begin_date: '2026-09-01T03:00:00Z', end_date: '2026-09-30T03:00:00Z', id: 4, status: 'processed' };
  assert.equal(findReport([early, other], '2026-10'), undefined);
  assert.equal(findReport([early, pending], '2026-10').id, 2);
  assert.equal(findReport([early, pending, late], '2026-10').id, 3);
  assert.equal(findReport([other], '2026-09').id, 4);
});

test('a report is ready when processed, or enabled with a file name', () => {
  assert.equal(reportState({ status: 'processed' }), 'ready');
  assert.equal(reportState({ status: 'enabled', file_name: 'r.csv' }), 'ready');
  assert.equal(reportState({ status: 'enabled' }), 'pending');
  assert.equal(reportState({ status: 'pending' }), 'pending');
  assert.equal(reportState({ status: 'deleted', file_name: 'r.csv' }), 'failed');
});

test('sync notes progress about once a minute while it waits', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock, never: true });
  const lines = [];
  await sync({ api, folder: memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') }), clock, sleep, log: (l) => lines.push(l), waitMinutes: 3 });
  assert.equal(lines.filter((l) => l.startsWith('waiting ')).length, 2);
  assert.ok(lines.includes('waiting 1 min: 2026-10 pending'));
});

// ---- sync ----

test('sync asks for the month, waits, saves it and sets the partial file aside', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock, readyAfter: 3 });
  const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09'), [LEGACY_PARTIAL_OCT]: csv('2026-10') });
  const result = await sync({ api, folder, clock, sleep, log: quiet });
  assert.deepEqual(result.fetched, ['2026-10']);
  assert.deepEqual(result.failed, []);
  assert.equal(api.calls.create, 1);
  assert.match(folder.store['release-2026-10.csv'], /;SF_MERCHANT;SF_CATEGORY_CODE;SF_RECIPIENT\n/);
  assert.equal(folder.store[`replaced/${LEGACY_PARTIAL_OCT}`], csv('2026-10'));
  assert.equal(folder.store[LEGACY_PARTIAL_OCT], undefined);
});

test('sync reuses a report that is already there instead of asking again', async () => {
  const { clock, sleep } = fakeClock();
  const ready = {
    id: 9,
    begin_date: '2026-10-01T03:00:00Z',
    end_date: '2026-10-31T23:59:59-03:00',
    status: 'processed',
    generation_date: '2026-11-01T03:10:00Z',
    file_name: 'scheduled-oct.csv',
  };
  const api = fakeMercadoPago({ clock, existing: [ready] });
  const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') });
  const result = await sync({ api, folder, clock, sleep, log: quiet });
  assert.deepEqual(result.fetched, ['2026-10']);
  assert.equal(api.calls.create, 0);
  assert.deepEqual(api.calls.download, ['scheduled-oct.csv']);
});

test('a report still generating at the deadline is left pending, and the next run picks it up', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock, never: true });
  const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') });
  const first = await sync({ api, folder, clock, sleep, log: quiet, waitMinutes: 2, pollSeconds: 30 });
  assert.deepEqual(first.pending, ['2026-10']);
  assert.equal(folder.store['release-2026-10.csv'], undefined);

  const again = await sync({ api, folder, clock, sleep, log: quiet, waitMinutes: 1 });
  assert.deepEqual(again.pending, ['2026-10']);
  assert.equal(api.calls.create, 1); // the pending report was reused, not asked for twice
});

test('a download that holds another month is rejected and the old file stays', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock, serve: () => rawCsv('2026-09') });
  const folder = memoryFolder({ [LEGACY_PARTIAL_OCT]: csv('2026-10') });
  const result = await sync({ api, folder, clock, sleep, log: quiet });
  assert.deepEqual(result.fetched, []);
  assert.match(result.failed[0].reason, /holds 2026-09/);
  assert.ok(folder.store['rejected/release-2026-10.csv']);
  assert.ok(folder.store[LEGACY_PARTIAL_OCT]);
  assert.equal(folder.store['release-2026-10.csv'], undefined);
});

test('HTTP 203 on create is retried; other refusals are reported per month', async () => {
  const { clock, sleep } = fakeClock();
  const retried = fakeMercadoPago({ clock, createStatuses: [203, 202] });
  const r1 = await sync({ api: retried, folder: memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') }), clock, sleep, log: quiet });
  assert.deepEqual(r1.fetched, ['2026-10']);
  assert.equal(retried.calls.create, 2);

  const refused = fakeMercadoPago({ clock, createStatuses: [400] });
  const r2 = await sync({ api: refused, folder: memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') }), clock, sleep, log: quiet });
  assert.match(r2.failed[0].reason, /HTTP 400/);
});

test('a refused token stops sync with a clear message', async () => {
  const refused = async () => ({ status: 401, data: null, text: '{"message":"invalid_token"}' });
  const api = { config: refused, list: refused };
  const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') });
  await assert.rejects(sync({ api, folder, ...fakeClock(), log: quiet }), /refused the token \(HTTP 401\)/);
});

test('the API adapter sends the token and the Argentine month range', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return { status: 202, ok: true, text: async () => '{}' };
  };
  await mercadoPagoApi('TEST-token', fetchImpl).create('2026-02');
  assert.equal(seen[0].url, 'https://api.mercadopago.com/v1/account/release_report');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer TEST-token');
  assert.deepEqual(JSON.parse(seen[0].init.body), { begin_date: '2026-02-01T03:00:00Z', end_date: '2026-02-28T03:00:00Z' });
});

test('the token comes from the environment first, then from .env.mercadopago, in a worktree too', () => {
  const primary = '/repo';
  const worktree = '/repo/.claude/worktrees/x';
  const files = { '/repo/.env.mercadopago': 'PUBLIC_KEY=TEST-pub\nACCESS_TOKEN="TEST-from-file"\n' };
  const read = (f) => {
    if (!(f in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return files[f];
  };
  const warnings = [];
  const opts = { read, stat: () => ({ mode: 0o100600 }), warn: (w) => warnings.push(w) };
  assert.equal(loadToken({ ...opts, env: { MP_ACCESS_TOKEN: 'TEST-env' }, root: primary }), 'TEST-env');
  assert.equal(loadToken({ ...opts, env: {}, root: primary }), 'TEST-from-file');
  assert.equal(loadToken({ ...opts, env: {}, root: worktree }), 'TEST-from-file');
  assert.deepEqual(warnings, []);

  loadToken({ ...opts, stat: () => ({ mode: 0o100644 }), env: {}, root: primary });
  assert.match(warnings[0], /chmod 600/);
  assert.doesNotMatch(warnings[0], /TEST-from-file/);

  assert.equal(loadToken({ ...opts, env: {}, root: '/elsewhere' }), null);
  files['/repo/.env.mercadopago'] = 'PUBLIC_KEY=TEST-pub\n';
  assert.throws(() => loadToken({ ...opts, env: {}, root: primary }), /has no ACCESS_TOKEN line/);
});

// ---- enrichment (T-ENR-13 to T-ENR-15) ----

// Made-up month: a shop purchase (held, then released), money received from a person, a payout to a bank account,
// and an expense no search returns.
const rawReport = [
  RAW_HEADER,
  rawRow('2026-10-01T00:00:00.000-03:00', '', '', '1000.00', '0.00', '1000.00'),
  rawRow('2026-10-02T10:00:00.000-03:00', '901', 'payment', '0.00', '100.00', '900.00', 'Owner Example'),
  rawRow('2026-10-02T10:00:00.000-03:00', '901', 'reserve_for_payment', '0.00', '0.00', '900.00', 'Owner Example'),
  rawRow('2026-10-03T10:00:00.000-03:00', '902', 'payment', '50.00', '0.00', '950.00', 'Ana Example'),
  rawRow('2026-10-04T10:00:00.000-03:00', '903', 'payout', '0.00', '200.00', '750.00', '', '0000003100099990000001'),
  rawRow('2026-10-05T10:00:00.000-03:00', '904', 'payment', '0.00', '10.00', '740.00', 'Owner Example'),
  ';;;740.00;0.00;0.00;0.00;0.00;;;;;0.00;;;;',
].join('\n');
const SHOP_PAYMENT = {
  id: 901,
  description: 'Made-up item',
  collector: { id: 7777001, email: 'shop@example.com' },
  payer: { id: 4242, email: 'owner@example.com', phone: { number: '1155550000' } },
  point_of_interaction: { transaction_data: { commerce: { name: 'Made-up Cafe; Bar\n"Centro"', mcc: '5812' } } },
};
const RECEIVED_PAYMENT = { id: 902, payer: { id: 8888002, email: 'ana@example.com', identification: { number: '20123456789' } }, collector: { id: 4242 } };
const cellsOf = (text) => {
  const [head, ...lines] = text.split('\n');
  const names = head.split(';');
  return lines.map((l) => Object.fromEntries(l.split(';').map((v, i) => [names[i], v])));
};

test('T-ENR-13 cleaning turns separators, quotes, line breaks and control characters into single spaces, trims and cuts', () => {
  assert.equal(cleanValue('  Made-up;Cafe "Centro"\r\nBar\tSur\u0000x  '), 'Made-up Cafe Centro Bar Sur x');
  assert.equal(cleanValue('a'.repeat(100)), 'a'.repeat(80));
  assert.equal(cleanValue(`${'b'.repeat(79)} c`), 'b'.repeat(79), 'a cut never leaves a trailing space');
  assert.equal(cleanValue(undefined), '');
  assert.equal(cleanValue(12345), '12345');
  assert.equal(cleanValue('x\u007fy\u0085z'), 'x y z');
});

test('T-ENR-14 recipientKey is 32 hex characters, stable for one hashing key and different across keys and parties', () => {
  const k = recipientKey(HASH_KEY, 'mp', '7777001');
  assert.match(k, /^[0-9a-f]{32}$/);
  assert.equal(recipientKey(HASH_KEY, 'mp', 7777001), k);
  assert.notEqual(recipientKey(Buffer.alloc(32, 8), 'mp', '7777001'), k);
  assert.notEqual(recipientKey(HASH_KEY, 'mp', '7777002'), k);
  assert.notEqual(recipientKey(HASH_KEY, 'bank', '7777001'), k, 'a bank account and a user id never share a key');
  // Known answer: HMAC-SHA256 over "mp:7777001" with 32 bytes of 7, first 32 hex characters. A change here
  // would orphan every stored label.
  assert.equal(k, 'f1feb6fcab7f6cef4e4281b1107e6748');
  assert.throws(() => recipientKey(HASH_KEY, 'other', '1'), /kind/);
  assert.throws(() => recipientKey(HASH_KEY, 'mp', ''), /empty/);
});

test('T-ENR-14 loadHashKey creates a key file with mode 600 once, then reads it back; a bad file is refused', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mp-key-'));
  try {
    const warnings = [];
    const first = loadHashKey(dir, { warn: (w) => warnings.push(w) });
    assert.equal(first.length, 32);
    const file = path.join(dir, HASH_KEY_FILE);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.match(readFileSync(file, 'utf8'), /^[0-9a-f]{64}\n?$/);
    assert.deepEqual(loadHashKey(dir, { warn: (w) => warnings.push(w) }), first);
    assert.deepEqual(warnings, [], 'a new key with no enriched files on disk needs no warning');

    writeFileSync(file, 'not a key');
    assert.throws(() => loadHashKey(dir), /not 64 hex characters/);
    assert.equal(readFileSync(file, 'utf8'), 'not a key', 'a bad key file is never overwritten');
    assert.doesNotMatch(String((() => { try { loadHashKey(dir); } catch (e) { return e.message; } })()), /not a key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-ENR-14 a new hashing key next to enriched files warns that old labels will not match', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mp-key-'));
  try {
    writeFileSync(path.join(dir, 'release-2026-09.csv'), `${HEADER};SF_MERCHANT;SF_CATEGORY_CODE;SF_RECIPIENT\n`);
    const warnings = [];
    loadHashKey(dir, { warn: (w) => warnings.push(w) });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /new hashing key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-ENR-15 enrichReport appends the three columns per operation and drops the raw columns', () => {
  const out = enrichReport(rawReport, { payments: { asPayer: [SHOP_PAYMENT], asCollector: [RECEIVED_PAYMENT] }, hashKey: HASH_KEY });
  const [head] = out.split('\n');
  assert.equal(head, `${HEADER};SF_MERCHANT;SF_CATEGORY_CODE;SF_RECIPIENT`);
  const rows = cellsOf(out);
  const byId = (id) => rows.filter((r) => r.SOURCE_ID === id);
  for (const r of byId('901')) {
    assert.deepEqual([r.SF_MERCHANT, r.SF_CATEGORY_CODE, r.SF_RECIPIENT], ['Made-up Cafe Bar Centro', '5812', recipientKey(HASH_KEY, 'mp', '7777001')]);
  }
  // Money received: the sender's name from the report, the key of the payer in the collector search.
  assert.deepEqual(
    [byId('902')[0].SF_MERCHANT, byId('902')[0].SF_CATEGORY_CODE, byId('902')[0].SF_RECIPIENT],
    ['Ana Example', '', recipientKey(HASH_KEY, 'mp', '8888002')],
  );
  // A payout: no name, the key of the bank account.
  assert.deepEqual([byId('903')[0].SF_MERCHANT, byId('903')[0].SF_RECIPIENT], ['', recipientKey(HASH_KEY, 'bank', '0000003100099990000001')]);
  // An expense no search returned: the report's payer name is the owner, so it is never used for an expense.
  assert.deepEqual([byId('904')[0].SF_MERCHANT, byId('904')[0].SF_CATEGORY_CODE, byId('904')[0].SF_RECIPIENT], ['', '', '']);
  // Opening and totals rows carry empty cells.
  for (const r of [rows[0], rows.at(-1)]) assert.deepEqual([r.SF_MERCHANT, r.SF_CATEGORY_CODE, r.SF_RECIPIENT], ['', '', '']);
  assert.ok(rows.every((r) => Object.keys(r).length === 18));
});

test('T-ENR-15 the enriched file holds no raw id, account number, email, phone or ID number, and imports as the same month', () => {
  const out = enrichReport(rawReport, { payments: { asPayer: [SHOP_PAYMENT], asCollector: [RECEIVED_PAYMENT] }, hashKey: HASH_KEY });
  for (const secret of ['PAYER_NAME', 'PAYOUT_BANK_ACCOUNT_NUMBER', 'Owner Example', '7777001', '8888002', '4242', '0000003100099990000001', 'example.com', '1155550000', '20123456789']) {
    assert.ok(!out.includes(secret), `the enriched file must not hold ${secret}`);
  }
  const parsed = parseReleaseReport(out, { file: 'release-2026-10.csv' });
  assert.equal(parsed.check.month, '2026-10');
  assert.ok(parsed.check.closingMatches && parsed.check.monthNetMatches);
  const shop = parsed.transactions.find((t) => t.source_ref.endsWith('#901'));
  assert.deepEqual([shop.merchant, shop.category], ['Made-up Cafe Bar Centro', 'Dining out']);
  assert.equal(parsed.transactions.find((t) => t.source_ref.endsWith('#902')).merchant, 'Ana Example');
});

test('T-ENR-15 a merchant made only of an email or a phone number is left empty; contact details inside a name are removed', () => {
  const pay = (id, name) => ({ id, collector: { id: 1 }, point_of_interaction: { transaction_data: { commerce: { name } } } });
  const one = (name) =>
    cellsOf(
      enrichReport(
        [HEADER, row('2026-10-01T00:00:00.000-03:00', '', '', '10.00', '0.00', '10.00'), row('2026-10-02T10:00:00.000-03:00', '5', 'payment', '0.00', '1.00', '9.00'), ';;;9.00;0.00;0.00;0.00;0.00;;;;;0.00;;'].join('\n'),
        { payments: { asPayer: [pay(5, name)], asCollector: [] }, hashKey: HASH_KEY },
      ),
    )[1].SF_MERCHANT;
  assert.equal(one('someone@example.com'), '');
  assert.equal(one('+54 11 5555-0000'), '');
  assert.equal(one('Made-up Shop someone@example.com 11 5555 0000'), 'Made-up Shop');
  assert.equal(one('Made-up 24 Kiosk'), 'Made-up 24 Kiosk', 'short numbers in a shop name stay');
  assert.equal(one('Made-up Shop 12.345.678 x'), 'Made-up Shop x', 'an ID number written with dots is removed');
});

test('T-ENR-15 the description, then the first item title, stand in for a missing commerce name; a bad code is left out', () => {
  const base = [HEADER, row('2026-10-01T00:00:00.000-03:00', '', '', '10.00', '0.00', '10.00'), row('2026-10-02T10:00:00.000-03:00', '5', 'payment', '0.00', '1.00', '9.00'), ';;;9.00;0.00;0.00;0.00;0.00;;;;;0.00;;'].join('\n');
  const first = (payment) => cellsOf(enrichReport(base, { payments: { asPayer: [payment], asCollector: [] }, hashKey: HASH_KEY }))[1];
  assert.equal(first({ id: '5', description: 'Made-up Store', additional_info: { items: [{ title: 'Made-up item' }] } }).SF_MERCHANT, 'Made-up Store');
  assert.equal(first({ id: 5, additional_info: { items: [{ title: 'Made-up item' }] } }).SF_MERCHANT, 'Made-up item');
  const odd = first({ id: 5, point_of_interaction: { transaction_data: { commerce: { mcc: '58123' } } } });
  assert.deepEqual([odd.SF_CATEGORY_CODE, odd.SF_RECIPIENT], ['', '']);
  // A file without the raw columns still enriches.
  assert.equal(cellsOf(enrichReport(base, { payments: { asPayer: [], asCollector: [] }, hashKey: HASH_KEY }))[1].SF_MERCHANT, '');
});

test('T-ENR-15 quoted raw header cells are still dropped', () => {
  const quoted = rawReport.replace('PAYER_NAME;PAYOUT_BANK_ACCOUNT_NUMBER', '"PAYER_NAME";" PAYOUT_BANK_ACCOUNT_NUMBER"');
  const out = enrichReport(quoted, { payments: { asPayer: [SHOP_PAYMENT], asCollector: [RECEIVED_PAYMENT] }, hashKey: HASH_KEY });
  for (const raw of ['PAYER_NAME', 'PAYOUT_BANK_ACCOUNT_NUMBER', 'Owner Example', '0000003100099990000001']) assert.ok(!out.includes(raw), `must not hold ${raw}`);
  assert.equal(out.split('\n')[0], `${HEADER};SF_MERCHANT;SF_CATEGORY_CODE;SF_RECIPIENT`);
});

test('T-ENR-15 the payer name is used only for money received, never for a refund, interest or a release', () => {
  const report = [
    RAW_HEADER,
    rawRow('2026-10-01T00:00:00.000-03:00', '', '', '100.00', '0.00', '100.00'),
    rawRow('2026-10-02T10:00:00.000-03:00', '71', 'refund', '30.00', '0.00', '130.00', 'Owner Example'),
    rawRow('2026-10-03T10:00:00.000-03:00', '72', 'asset_management', '1.00', '0.00', '131.00', 'Owner Example'),
    rawRow('2026-10-04T10:00:00.000-03:00', '73', 'reserve_for_payment', '5.00', '0.00', '136.00', 'Owner Example'),
    rawRow('2026-10-05T10:00:00.000-03:00', '74', 'payment', '9.00', '0.00', '145.00', 'Ana Example'),
    ';;;145.00;0.00;0.00;0.00;0.00;;;;;0.00;;;;',
  ].join('\n');
  const rows = cellsOf(enrichReport(report, { payments: { asPayer: [], asCollector: [] }, hashKey: HASH_KEY }));
  assert.deepEqual(rows.slice(1, -1).map((r) => [r.SOURCE_ID, r.SF_MERCHANT]), [['71', ''], ['72', ''], ['73', ''], ['74', 'Ana Example']]);
});

// ---- sync with enrichment (T-ENR-16 to T-ENR-18) ----

test('T-ENR-16 sync stops with the config instruction when the config lacks a D-19 column, and asks for nothing', async () => {
  for (const missing of D19) {
    const { clock, sleep } = fakeClock();
    const api = fakeMercadoPago({ clock, columns: [...LIVE_COLUMNS, ...D19].filter((c) => c !== missing) });
    const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') });
    await assert.rejects(sync({ api, folder, clock, sleep, log: quiet }), new RegExp(`${missing}.*node scripts/mercadopago-report\\.mjs config`, 's'));
    assert.equal(api.calls.config, 1);
    assert.equal(api.calls.create, 0);
    assert.equal(api.calls.list, 0);
    assert.deepEqual(Object.keys(folder.store), ['release-2026-09.csv']);
  }
});

test('T-ENR-16 a download made before the config change is discarded and one new report is asked for', async () => {
  const { clock, sleep } = fakeClock();
  let served = 0;
  // The first download is the old 15-column report; the new one has the D-19 columns.
  const api = fakeMercadoPago({ clock, serve: (ym) => (served++ === 0 ? csv(ym) : rawCsv(ym)) });
  const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') });
  const lines = [];
  const result = await sync({ api, folder, clock, sleep, log: (l) => lines.push(l) });
  assert.deepEqual(result.fetched, ['2026-10']);
  assert.equal(api.calls.create, 2, 'the month was asked for, then asked for once more');
  assert.equal(api.calls.download.length, 2);
  assert.notEqual(api.calls.download[0], api.calls.download[1], 'the discarded report is not downloaded again');
  assert.match(folder.store['release-2026-10.csv'], /;SF_MERCHANT;SF_CATEGORY_CODE;SF_RECIPIENT\n/);
  assert.ok(lines.some((l) => /^2026-10: the report was made before the config change .*asked for a new one$/.test(l)));
  // The column check after the first enriched save: present or not, and how many rows fill it. No values.
  assert.ok(lines.includes('column check: PAYER_NAME present, 2 rows filled'));
  assert.ok(lines.includes('column check: PAYOUT_BANK_ACCOUNT_NUMBER present, 0 rows filled'));
  assert.ok(!lines.join('\n').includes('Example'));
});

test('T-ENR-16 a second download still without the D-19 columns fails the month and saves nothing', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock, serve: csv });
  const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') });
  const result = await sync({ api, folder, clock, sleep, log: quiet });
  assert.equal(api.calls.create, 2);
  assert.deepEqual(result.failed, [{ month: '2026-10', reason: 'report_without_d19_columns' }]);
  assert.deepEqual(Object.keys(folder.store), ['release-2026-09.csv']);
});

test('T-ENR-16 names, codes and keys reach the saved file; raw ids and the raw columns do not', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock });
  const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') });
  await sync({ api, folder, clock, sleep, log: quiet });
  const text = folder.store['release-2026-10.csv'];
  const saved = parseReleaseReport(text, { file: 'release-2026-10.csv' }).transactions;
  assert.deepEqual(
    saved.map((t) => [t.merchant, t.category, t.recipient_key]),
    [
      ['Made-up Cafe', 'Dining out', recipientKey(HASH_KEY, 'mp', '7777001')],
      ['Ana Example', 'Uncategorized', recipientKey(HASH_KEY, 'mp', '8888002')],
    ],
  );
  for (const raw of ['7777001', '8888002', 'example.com', 'Owner Example', 'PAYER_NAME']) assert.ok(!text.includes(raw), `must not hold ${raw}`);
  // Both searches ask as you, from a week before the month, 50 at a time.
  assert.ok(api.calls.get.some((p) => p.includes(`payer.id=${ME}`) && p.includes('limit=50') && p.includes('begin_date=2026-09-24')));
  assert.ok(api.calls.get.some((p) => p.includes(`collector.id=${ME}`)));
});

test('T-ENR-17 a failing search saves nothing for the month and the error line has month, code and status only', async () => {
  const { clock, sleep } = fakeClock();
  const body = '{"message":"secret detail Ana Example"}';
  const api = fakeMercadoPago({ clock, search: async () => ({ status: 500, data: JSON.parse(body), text: body }) });
  const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') });
  const lines = [];
  const result = await sync({ api, folder, clock, sleep, log: (l) => lines.push(l) });
  assert.deepEqual(result.fetched, []);
  assert.deepEqual(result.failed, [{ month: '2026-10', reason: 'search_failed', status: 500 }]);
  assert.ok(lines.includes('2026-10: failed: search_failed, HTTP 500; nothing saved, the next run tries again'));
  assert.ok(!lines.join('\n').includes('secret'));
  assert.deepEqual(Object.keys(folder.store), ['release-2026-09.csv']);
});

test('T-ENR-17 a search that hangs past the timeout counts as failed and saves nothing', async () => {
  const { clock, sleep } = fakeClock();
  const signals = [];
  const api = fakeMercadoPago({
    clock,
    search: (p, opts) => {
      signals.push(opts?.signal);
      return new Promise(() => {}); // never answers
    },
  });
  const folder = memoryFolder({ 'release-2026-09.csv': enrichedCsv('2026-09') });
  const asked = [];
  const timeout = (ms) => {
    asked.push(ms);
    return AbortSignal.abort(new DOMException('timed out', 'TimeoutError'));
  };
  const result = await sync({ api, folder, clock, sleep, log: quiet, timeout });
  assert.deepEqual(result.failed, [{ month: '2026-10', reason: 'search_timeout' }]);
  assert.ok(asked.length >= 1 && asked.every((ms) => ms === 30_000), 'each request gets 30 s');
  assert.ok(signals[0] instanceof AbortSignal, 'the request gets the signal, so the real fetch is cancelled');
  assert.equal(folder.store['release-2026-10.csv'], undefined);
});

test('T-ENR-17 searchPayments pages through both searches and returns them apart; a refusal carries its status only', async () => {
  const pages = [];
  const api = {
    async get(p) {
      pages.push(p);
      if (p === '/users/me') return { status: 200, data: { id: ME }, text: '' };
      const offset = Number(new URLSearchParams(p.split('?')[1]).get('offset'));
      const asPayer = p.includes(`payer.id=${ME}`);
      const total = asPayer ? 60 : 1;
      const count = Math.max(0, Math.min(50, total - offset));
      const results = Array.from({ length: count }, (_, i) => ({ id: (asPayer ? 1000 : 2000) + offset + i }));
      return { status: 200, data: { paging: { total }, results }, text: '' };
    },
  };
  const found = await searchPayments({ api, ym: '2026-10' });
  assert.equal(found.asPayer.length, 60);
  assert.equal(found.asCollector.length, 1);
  assert.equal(pages.filter((p) => p.includes(`payer.id=${ME}`)).length, 2);
  const refused = searchPayments({ api: { get: async () => ({ status: 401, data: null, text: 'body text' }) }, ym: '2026-10' });
  await assert.rejects(refused, (e) => e.code === 'search_failed' && e.status === 401 && !e.message.includes('body'));
});

test('T-ENR-18 a plain month on disk is fetched again and set aside; an enriched month is not', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock });
  const folder = memoryFolder({ 'release-2026-08.csv': enrichedCsv('2026-08'), 'release-2026-09.csv': csv('2026-09') });
  const result = await sync({ api, folder, clock, sleep, log: quiet });
  assert.deepEqual(result.fetched, ['2026-09', '2026-10']);
  assert.equal(folder.store['replaced/release-2026-09.csv'], csv('2026-09'), 'the plain file is kept in replaced/');
  assert.match(folder.store['release-2026-09.csv'], /SF_RECIPIENT/);
  assert.equal(folder.store['release-2026-08.csv'], enrichedCsv('2026-08'));
  assert.equal(holdsFullMonth({ name: 'release-2026-09.csv', text: csv('2026-09') }, '2026-09'), false);
  assert.equal(holdsFullMonth({ name: 'release-2026-09.csv', text: enrichedCsv('2026-09') }, '2026-09'), true);
});

test('T-ENR-18 a rejected download holds no raw columns, and the old file stays', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock, serve: () => rawCsv('2026-09') });
  const folder = memoryFolder({ 'release-2026-10.csv': csv('2026-10') });
  const result = await sync({ api, folder, clock, sleep, log: quiet, from: '2026-10' });
  assert.match(result.failed[0].reason, /holds 2026-09/);
  const rejected = folder.store['rejected/release-2026-10.csv'];
  assert.ok(rejected);
  for (const raw of ['PAYER_NAME', 'PAYOUT_BANK_ACCOUNT_NUMBER', 'Owner Example']) assert.ok(!rejected.includes(raw), `rejected/ must not hold ${raw}`);
  assert.equal(folder.store['release-2026-10.csv'], csv('2026-10'));
});
