// Runs sync against a fake Mercado Pago, an in-memory folder and a fake clock. Report data is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findReport,
  lastFullMonth,
  loadToken,
  mercadoPagoApi,
  monthBounds,
  planSync,
  reportState,
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
  };
}

function fakeClock(start = NOW) {
  let t = start;
  return { clock: () => t, sleep: async (ms) => void (t += ms) };
}

// Reports turn "processed" after `readyAfter` list calls; `serve` picks the CSV each download gets.
function fakeMercadoPago({ clock, readyAfter = 1, never = false, existing = [], serve = csv, createStatuses = [] }) {
  const reports = [...existing];
  const calls = { create: 0, list: 0, download: [] };
  return {
    reports,
    calls,
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
      { name: 'release-2026-08.csv', text: csv('2026-08') },
      { name: 'reserve-release-1-manual-2026-10-20-160928.csv', text: csv('2026-09') }, // made after Sep ended
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
      { name: 'release-2026-07.csv', text: csv('2026-07') },
      { name: 'release-2026-09.csv', text: csv('2026-09') },
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
  await sync({ api, folder: memoryFolder({ 'release-2026-09.csv': csv('2026-09') }), clock, sleep, log: (l) => lines.push(l), waitMinutes: 3 });
  assert.equal(lines.filter((l) => l.startsWith('waiting ')).length, 2);
  assert.ok(lines.includes('waiting 1 min: 2026-10 pending'));
});

// ---- sync ----

test('sync asks for the month, waits, saves it and sets the partial file aside', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock, readyAfter: 3 });
  const folder = memoryFolder({ 'release-2026-09.csv': csv('2026-09'), [LEGACY_PARTIAL_OCT]: csv('2026-10') });
  const result = await sync({ api, folder, clock, sleep, log: quiet });
  assert.deepEqual(result.fetched, ['2026-10']);
  assert.deepEqual(result.failed, []);
  assert.equal(api.calls.create, 1);
  assert.equal(folder.store['release-2026-10.csv'], csv('2026-10'));
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
  const folder = memoryFolder({ 'release-2026-09.csv': csv('2026-09') });
  const result = await sync({ api, folder, clock, sleep, log: quiet });
  assert.deepEqual(result.fetched, ['2026-10']);
  assert.equal(api.calls.create, 0);
  assert.deepEqual(api.calls.download, ['scheduled-oct.csv']);
});

test('a report still generating at the deadline is left pending, and the next run picks it up', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock, never: true });
  const folder = memoryFolder({ 'release-2026-09.csv': csv('2026-09') });
  const first = await sync({ api, folder, clock, sleep, log: quiet, waitMinutes: 2, pollSeconds: 30 });
  assert.deepEqual(first.pending, ['2026-10']);
  assert.equal(folder.store['release-2026-10.csv'], undefined);

  const again = await sync({ api, folder, clock, sleep, log: quiet, waitMinutes: 1 });
  assert.deepEqual(again.pending, ['2026-10']);
  assert.equal(api.calls.create, 1); // the pending report was reused, not asked for twice
});

test('a download that holds another month is rejected and the old file stays', async () => {
  const { clock, sleep } = fakeClock();
  const api = fakeMercadoPago({ clock, serve: () => csv('2026-09') });
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
  const r1 = await sync({ api: retried, folder: memoryFolder({ 'release-2026-09.csv': csv('2026-09') }), clock, sleep, log: quiet });
  assert.deepEqual(r1.fetched, ['2026-10']);
  assert.equal(retried.calls.create, 2);

  const refused = fakeMercadoPago({ clock, createStatuses: [400] });
  const r2 = await sync({ api: refused, folder: memoryFolder({ 'release-2026-09.csv': csv('2026-09') }), clock, sleep, log: quiet });
  assert.match(r2.failed[0].reason, /HTTP 400/);
});

test('a refused token stops sync with a clear message', async () => {
  const api = { list: async () => ({ status: 401, data: null, text: '{"message":"invalid_token"}' }) };
  const folder = memoryFolder({ 'release-2026-09.csv': csv('2026-09') });
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
