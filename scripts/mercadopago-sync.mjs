// Sync for the Mercado Pago "released money" report: finds the months that data/real/mercadopago/
// does not hold in full, asks Mercado Pago for each one, waits until it is generated, downloads it
// and checks that it parses as that month. scripts/mercadopago-report.mjs runs it; see the comment
// there for the token. Network, disk and clock come in as arguments, so the tests use fakes.
//
// Logs carry months, file names, counts and HTTP statuses only, never amounts or report content.
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PRIVATE_COLUMNS, parseReleaseReport } from '../apps/api/src/ingest/mercadopago.mjs';
import { toCents } from '../apps/api/src/ingest/schema.mjs';

export const BASE = 'https://api.mercadopago.com/v1/account/release_report';

// Argentina is UTC-3 all year, so local midnight is 03:00 UTC. The API treats the end date as
// INCLUSIVE of that whole local day (it stretches it to 23:59:59), so pass the last day of the month.
export const utcMidnightAR = (ymd) => `${ymd}T03:00:00Z`;
// The Argentine calendar day of an instant, whatever offset the API writes it with.
export const arDate = (instant) => new Date(Date.parse(instant) - 3 * 3600 * 1000).toISOString().slice(0, 10);

export const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${ym}-01`, last: `${ym}-${String(lastDay).padStart(2, '0')}` };
}

export function monthsBetween(from, to) {
  const out = [];
  for (let ym = from; ym <= to; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

// The month before the current Argentine month: the latest one that has ended.
export const lastFullMonth = (nowMs) => addMonths(arDate(new Date(nowMs).toISOString()).slice(0, 7), -1);

// Files written by sync are named for the month they hold.
export const syncedName = (ym) => `release-${ym}.csv`;

// Whether a file holds its month in full. Only a file with the enrichment columns counts (D-16): a plain file
// from before is fetched again and set aside. A file sync wrote asked for the whole month after it
// ended. Any other file counts only if the date in Mercado Pago's file name (…-YYYY-MM-DD-HHMMSS.csv,
// when the report was generated) is on or after the 2nd of the next month; the extra day covers not
// knowing that stamp's time zone. A file with no such stamp counts as full.
export function holdsFullMonth({ name, text }, month) {
  if (!ENRICHMENT_COLUMNS.every((c) => headerOf(text).includes(c))) return false;
  if (name === syncedName(month)) return true;
  const stamp = name.match(/-(\d{4}-\d{2}-\d{2})-\d{6}\.csv$/)?.[1];
  return !stamp || stamp >= `${addMonths(month, 1)}-02`;
}

export function coverage(files) {
  const full = new Map(); // month -> file name
  const partial = new Map(); // month -> file names
  const unreadable = [];
  for (const { name, text } of files) {
    let month;
    try {
      month = parseReleaseReport(text, { file: name }).check.month;
    } catch (e) {
      // The code only (private_columns, for example), never the parser's message.
      unreadable.push({ name, reason: e.code ?? 'not a release report sync can read' });
      continue;
    }
    if (holdsFullMonth({ name, text }, month)) full.set(month, name);
    else partial.set(month, [...(partial.get(month) ?? []), name]);
  }
  return { full, partial, unreadable };
}

// Which months to fetch. The range runs from `from` (default: the earliest month on disk) to `to`
// (default: the last month that has ended); a month is fetched unless a file holds it in full.
// Partial files are set aside once a full file for their month exists, because the importer keeps
// the first copy of a transaction it sees and the partial one would win.
export function planSync({ files, from, to, nowMs }) {
  for (const [flag, v] of [['--from', from], ['--to', to]]) {
    if (v !== undefined && !YM.test(v)) throw new Error(`${flag} must be YYYY-MM, got ${v}`);
  }
  const { full, partial, unreadable } = coverage(files);
  const last = lastFullMonth(nowMs);
  const end = to ?? last;
  if (end > last) throw new Error(`${end} has not ended yet; the last full month is ${last}`);
  const start = from ?? [...full.keys(), ...partial.keys()].sort()[0];
  if (!start) throw new Error('No Mercado Pago reports on disk yet. Pass --from YYYY-MM for the first month to fetch.');
  const months = start <= end ? monthsBetween(start, end).filter((m) => !full.has(m)) : [];
  const replaces = Object.fromEntries(months.map((m) => [m, partial.get(m) ?? []]));
  const stale = [...partial].filter(([m]) => full.has(m)).flatMap(([, names]) => names);
  return { start, end, months, replaces, stale, unreadable };
}

// ---- enrichment (ADR 0010) ----

// The report header's column names; a quoted cell counts as its name, as the importer reads it.
export const headerOf = (text) =>
  String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/, 1)[0]
    .split(';')
    .map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());

// Appended to the report header in this order; every data row of an operation carries the same values.
export const ENRICHMENT_COLUMNS = ['SF_MERCHANT', 'SF_CATEGORY_CODE', 'SF_RECIPIENT'];
const MERCHANT_LIMIT = 80;

// Every ';', '"', line break and other control character becomes a space, runs of spaces become one, and the
// value is trimmed and cut to the limit, so a cleaned value can never break the report's ';' format (AC-9).
export function cleanValue(value, limit = MERCHANT_LIMIT) {
  return String(value ?? '')
    .replace(/[;"\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, limit)
    .trimEnd();
}

// An email address or a phone or ID number (7 digits or more, single spaces, dots or dashes allowed between
// them) inside a name is removed before cleaning, so neither reaches a saved file (AC-10).
const CONTACTS = [/[^\s@;"]+@[^\s@;"]+/g, /\+?\d(?:[\s.-]?\d){6,}/g];
const withoutContacts = (value) => CONTACTS.reduce((v, re) => v.replace(re, ' '), String(value ?? ''));

// The hashing key (D-11, D-12): 32 random bytes as hex, next to the reports, created on first use with mode 600.
// data/* is git-ignored, so it never reaches git. Losing it means relabeling (RK-2).
export const HASH_KEY_FILE = '.hashing-key';

const holdsEnrichment = (dir) =>
  existsSync(dir) &&
  readdirSync(dir, { withFileTypes: true }).some(
    (e) => e.isFile() && e.name.endsWith('.csv') && readFileSync(path.join(dir, e.name), 'utf8').split(/\r?\n/, 1)[0].includes('SF_RECIPIENT'),
  );

export function loadHashKey(dir, { warn = console.warn } = {}) {
  const file = path.join(dir, HASH_KEY_FILE);
  if (existsSync(file)) {
    const hex = readFileSync(file, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`${file} is not 64 hex characters; restore it from your backup`);
    if (statSync(file).mode & 0o077) warn(`${file} can be read by other users on this machine; run: chmod 600 ${file}`);
    return Buffer.from(hex, 'hex');
  }
  const enrichedBefore = holdsEnrichment(dir);
  mkdirSync(dir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, `${key.toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600); // the umask can only drop bits; this makes the mode exact
  if (enrichedBefore) {
    warn(`created a new hashing key at ${file} while enriched reports already exist: their recipients get other keys, so old labels will not match new rows. Back this file up.`);
  }
  return key;
}

// The recipient key (Contracts "Recipient key"): HMAC-SHA256 over "mp:<payments user id>" or
// "bank:<payout account number>", lowercase hex, first 32 characters. The raw id never leaves this function.
export function recipientKey(hashKey, kind, id) {
  if (kind !== 'mp' && kind !== 'bank') throw new Error(`bad recipient kind ${JSON.stringify(kind)}: must be mp or bank`);
  const value = String(id ?? '').trim();
  if (!value) throw new Error('a recipient key needs a non-empty id');
  return createHmac('sha256', hashKey).update(`${kind}:${value}`).digest('hex').slice(0, 32);
}

// The row type that decides what an operation is, strongest first (as the importer reads it).
const PRIORITY = ['payout', 'refund', 'payment', 'tip', 'asset_management', 'reserve_for_payout', 'reserve_for_payment'];

const at = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const firstFilled = (...values) => values.map((v) => (v == null ? '' : String(v).trim())).find((v) => v !== '') ?? '';

// The three enrichment values of one operation. A purchase or payment you made takes the merchant and category
// code from the payer search and the key of its collector. Money received takes the sender's name from the
// report and the key of the payer from the collector search. A payout takes the key of its bank account.
// The report's payer name is used only for money received (a payment found in the collector search, or a
// payment or tip that adds money): on your own payments, refunds and interest it is your name.
function operationValues(cellsOf, { paid, received }, hashKey) {
  const id = cellsOf[0].SOURCE_ID;
  const first = (column) => firstFilled(...cellsOf.map((c) => c[column]));
  const net = cellsOf.reduce((s, c) => s + toCents(c.NET_CREDIT_AMOUNT || '0') - toCents(c.NET_DEBIT_AMOUNT || '0'), 0);
  const main = PRIORITY.find((type) => cellsOf.some((c) => c.DESCRIPTION === type));
  const payment = paid.get(id);
  const incoming = received.get(id);
  let merchant = '';
  let code = '';
  let party;
  if (main === 'payout') {
    const account = first('PAYOUT_BANK_ACCOUNT_NUMBER');
    if (account) party = ['bank', account];
  } else if (payment) {
    merchant = firstFilled(at(payment, 'point_of_interaction.transaction_data.commerce.name'), payment.description, at(payment, 'additional_info.items.0.title'));
    code = firstFilled(at(payment, 'point_of_interaction.transaction_data.commerce.mcc'));
    party = at(payment, 'collector.id') == null ? undefined : ['mp', at(payment, 'collector.id')];
  } else if (incoming || ((main === 'payment' || main === 'tip') && net > 0)) {
    merchant = first('PAYER_NAME');
    party = at(incoming, 'payer.id') == null ? undefined : ['mp', at(incoming, 'payer.id')];
  }
  return [
    cleanValue(withoutContacts(merchant)),
    /^\d{4}$/.test(code) ? code : '',
    party && String(party[1]).trim() ? recipientKey(hashKey, ...party) : '',
  ];
}

// The report text with the three enrichment columns appended and the raw columns (PAYER_NAME,
// PAYOUT_BANK_ACCOUNT_NUMBER) dropped (D-10, D-21). payments: the month's payer and collector searches.
export function enrichReport(text, { payments: { asPayer = [], asCollector = [] } = {}, hashKey }) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  // Quoted header cells count as their name, so a quoted raw column is still dropped.
  const header = headerOf(lines[0] ?? '');
  const dropped = new Set([...PRIVATE_COLUMNS, ...ENRICHMENT_COLUMNS]);
  const kept = header.map((name, i) => (dropped.has(name) ? -1 : i)).filter((i) => i >= 0);
  const rows = lines.slice(1).map((l) => {
    const cells = l.split(';');
    return { cells, named: Object.fromEntries(header.map((name, i) => [name, (cells[i] ?? '').trim()])) };
  });

  const ids = { paid: new Map(asPayer.map((p) => [String(p.id), p])), received: new Map(asCollector.map((p) => [String(p.id), p])) };
  const groups = new Map();
  for (const r of rows) {
    const id = r.named.SOURCE_ID;
    if (id) groups.set(id, [...(groups.get(id) ?? []), r.named]);
  }
  const values = new Map([...groups].map(([id, group]) => [id, operationValues(group, ids, hashKey)]));

  const out = [[...kept.map((i) => header[i]), ...ENRICHMENT_COLUMNS].join(';')];
  for (const r of rows) {
    const extra = values.get(r.named.SOURCE_ID) ?? ['', '', ''];
    out.push([...kept.map((i) => r.cells[i] ?? ''), ...extra].join(';'));
  }
  return out.join(eol) + (/\r?\n$/.test(text) ? eol : '');
}

// The report config default (D-19): the 15 columns the live report has, plus the payer name (the sender of
// money received) and the payout bank account (the payout's recipient key). `node scripts/mercadopago-report.mjs
// config` applies it; sync refuses to run until the config holds the last two.
export const REPORT_COLUMNS = Object.freeze([
  'DATE', 'SOURCE_ID', 'DESCRIPTION', 'NET_CREDIT_AMOUNT', 'NET_DEBIT_AMOUNT', 'GROSS_AMOUNT', 'MP_FEE_AMOUNT', 'TAXES_AMOUNT',
  'PAYMENT_METHOD', 'TRANSACTION_APPROVAL_DATE', 'BUSINESS_UNIT', 'SUB_UNIT', 'BALANCE_AMOUNT', 'PAYMENT_METHOD_TYPE', 'PURCHASE_ID',
  'PAYER_NAME', 'PAYOUT_BANK_ACCOUNT_NUMBER',
]);
// The columns sync needs and drops before anything is saved: exactly the ones the importer refuses (D-21).
export const D19_COLUMNS = REPORT_COLUMNS.filter((c) => PRIVATE_COLUMNS.includes(c));
if (D19_COLUMNS.length !== PRIVATE_COLUMNS.length) throw new Error('REPORT_COLUMNS must hold every column the importer refuses');
const CONFIG_STEP = 'node scripts/mercadopago-report.mjs config';

// Per D-19 column: present in the download or not, and how many rows fill it. Counts only, never a value.
export function columnCheck(text) {
  const header = headerOf(text);
  const rows = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter((l) => l.length > 0).map((l) => l.split(';'));
  return D19_COLUMNS.map((column) => {
    const i = header.indexOf(column);
    return { column, present: i >= 0, filled: i < 0 ? 0 : rows.filter((cells) => (cells[i] ?? '').trim() !== '').length };
  });
}

// ---- the payments search (D-17) ----

// A failed or timed-out search. The message holds the code and the HTTP status only, never a response body.
export class SearchFailed extends Error {
  constructor(code, status) {
    super(status ? `${code}, HTTP ${status}` : code);
    this.name = 'SearchFailed';
    this.code = code;
    if (status) this.status = status;
  }
}

export const SEARCH_TIMEOUT_MS = 30_000;

// One GET with its own timeout. The signal goes to the request, so the real fetch is cancelled too, and a
// request that ignores it still loses the race.
async function timedGet(api, apiPath, { timeout, timeoutMs }) {
  const signal = timeout(timeoutMs);
  const expired = new Promise((_, reject) => {
    const fail = () => reject(new SearchFailed('search_timeout'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  expired.catch(() => {}); // the timer may fire after the request has answered
  let res;
  try {
    res = await Promise.race([api.get(apiPath, { signal }), expired]);
  } catch (e) {
    if (e instanceof SearchFailed) throw e;
    throw new SearchFailed(signal.aborted ? 'search_timeout' : 'search_failed');
  }
  if (res.status !== 200) throw new SearchFailed('search_failed', res.status);
  return res;
}

async function searchAs(api, { begin, end, filter }, opts) {
  const results = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const q = new URLSearchParams({ sort: 'date_created', criteria: 'asc', range: 'date_created', begin_date: begin, end_date: end, limit: '50', offset: String(offset) });
    const res = await timedGet(api, `/v1/payments/search?${q}&${filter}`, opts);
    const total = res.data?.paging?.total ?? 0;
    const page = res.data?.results ?? [];
    results.push(...page);
    if (page.length < 50 || results.length >= total) break;
  }
  return results;
}

// The month's payments, searched as payer and as collector (the probe's search). A payment can be created a
// few days before the report releases it, so the range starts a week early. Each request has a 30 s timeout;
// any failure throws SearchFailed and the month is saved with nothing (D-17).
export async function searchPayments({ api, ym, timeout = (ms) => AbortSignal.timeout(ms), timeoutMs = SEARCH_TIMEOUT_MS }) {
  const opts = { timeout, timeoutMs };
  const me = await timedGet(api, '/users/me', opts);
  const myId = me.data?.id;
  if (myId == null) throw new SearchFailed('search_failed', me.status);
  const { first, last } = monthBounds(ym);
  const begin = new Date(Date.parse(`${first}T00:00:00.000-03:00`) - 7 * 864e5).toISOString();
  const end = new Date(Date.parse(`${last}T23:59:59.999-03:00`)).toISOString();
  return {
    asPayer: await searchAs(api, { begin, end, filter: `payer.id=${encodeURIComponent(myId)}` }, opts),
    asCollector: await searchAs(api, { begin, end, filter: `collector.id=${encodeURIComponent(myId)}` }, opts),
  };
}

// ---- the report list ----

// Mercado Pago's docs show "processed" once the file exists and "deleted" when removed. The live
// list shows "enabled" for a finished report (seen 2026-11-14), so that counts once there is a file
// name to download. Every download is still checked before it is saved.
const FAILED = new Set(['error', 'failed', 'deleted', 'expired']);

export function reportState(report) {
  const status = String(report.status ?? '').toLowerCase();
  if (FAILED.has(status)) return 'failed';
  if (status === 'processed' || (status === 'enabled' && report.file_name)) return 'ready';
  return 'pending';
}

const madeAt = (r) => r.generation_date ?? r.date_created ?? r.last_modified;

// A report asked for the whole month before the month was over holds only the days up to then.
export function madeAfterMonth(report, ym) {
  const made = madeAt(report);
  return !made || Date.parse(made) >= Date.parse(utcMidnightAR(`${addMonths(ym, 1)}-01`));
}

// The best report in the list for a month: ready before pending before failed, newest first.
// Ready reports generated before the month ended are left out.
export function findReport(list, ym) {
  const { first, last } = monthBounds(ym);
  const rank = { ready: 0, pending: 1, failed: 2 };
  const made = (r) => Date.parse(madeAt(r) ?? '') || 0;
  return list
    .filter((r) => r.begin_date && r.end_date && arDate(r.begin_date) === first && arDate(r.end_date) === last)
    .filter((r) => reportState(r) !== 'ready' || madeAfterMonth(r, ym))
    .sort((a, b) => rank[reportState(a)] - rank[reportState(b)] || made(b) - made(a))[0];
}

// ---- adapters ----

export function mercadoPagoApi(token, fetchImpl = fetch) {
  const auth = { Authorization: `Bearer ${token}` };
  async function call(method, suffix, body, signal) {
    const res = await fetchImpl(suffix.startsWith('https://') ? suffix : `${BASE}${suffix}`, {
      method,
      headers: { ...auth, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      ...(signal ? { signal } : {}),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON; callers fall back to text
    }
    return { status: res.status, data, text };
  }
  return {
    create(ym) {
      const { first, last } = monthBounds(ym);
      return call('POST', '', { begin_date: utcMidnightAR(first), end_date: utcMidnightAR(last) });
    },
    list: () => call('GET', '/list'),
    config: () => call('GET', '/config'),
    schedule: (on) => call(on ? 'POST' : 'DELETE', '/schedule'),
    // Any other read on api.mercadopago.com, for example '/users/me' or '/v1/payments/search?…'.
    // signal: an AbortSignal, so a search that hangs is cancelled (D-17).
    get: (apiPath, { signal } = {}) => call('GET', `https://api.mercadopago.com${apiPath}`, undefined, signal),
    async download(fileName) {
      const res = await fetchImpl(`${BASE}/${encodeURIComponent(fileName)}`, { headers: auth });
      if (!res.ok) throw new Error(`downloading ${fileName} answered HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

// The report folder. Only top-level *.csv files are read; set-aside files go to subfolders.
export function reportFolder(dir) {
  return {
    read: () =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith('.csv'))
            .map((e) => e.name)
            .sort()
            .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }))
        : [],
    write(name, buf) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), buf);
    },
    setAside(name, sub) {
      mkdirSync(path.join(dir, sub), { recursive: true });
      renameSync(path.join(dir, name), path.join(dir, sub, path.basename(name)));
    },
    hashKey: () => loadHashKey(dir),
  };
}

// ---- the token ----

// MP_ACCESS_TOKEN from the environment wins. Otherwise ACCESS_TOKEN (or MP_ACCESS_TOKEN) from
// .env.mercadopago at the repo root, or at the primary checkout's root when this runs in a worktree.
// .gitignore keeps .env.* out of git. The value is never printed.
export function loadToken({ env = process.env, root, read = readFileSync, stat = statSync, warn = console.warn } = {}) {
  if (env.MP_ACCESS_TOKEN) return env.MP_ACCESS_TOKEN;
  const roots = [root, root.split(`${path.sep}.claude${path.sep}worktrees${path.sep}`)[0]];
  for (const dir of [...new Set(roots)]) {
    const file = path.join(dir, '.env.mercadopago');
    let text;
    try {
      text = read(file, 'utf8');
    } catch {
      continue;
    }
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    const token = values.ACCESS_TOKEN || values.MP_ACCESS_TOKEN;
    if (!token) throw new Error(`${file} has no ACCESS_TOKEN line`);
    if (stat(file).mode & 0o077) warn(`${file} can be read by other users on this machine; run: chmod 600 ${file}`);
    return token;
  }
  return null;
}

// ---- sync ----

// Error lines and failure reasons carry the month, a code or a short fixed text, and the HTTP status only:
// never a response body, a parser message or a cell value (AC-10).
const tokenRefused = (res) => new Error(`Mercado Pago refused the token (HTTP ${res.status}). Check MP_ACCESS_TOKEN.`);

function reportList(res) {
  if (res.status === 401 || res.status === 403) throw tokenRefused(res);
  if (res.status !== 200) throw new Error(`listing reports answered HTTP ${res.status}`);
  const list = Array.isArray(res.data) ? res.data : res.data?.results;
  if (!Array.isArray(list)) throw new Error('listing reports did not return a list');
  return list;
}

// Before planning: the report config must hold the D-19 columns, or every month would lack names and keys.
// Nothing is asked for or saved until the owner applies the config (D-19).
async function checkConfig(api) {
  const res = await api.config();
  if (res.status === 401 || res.status === 403) throw tokenRefused(res);
  if (res.status !== 200) throw new Error(`reading the report config answered HTTP ${res.status}`);
  const keys = (Array.isArray(res.data?.columns) ? res.data.columns : []).map((c) => c?.key);
  const missing = D19_COLUMNS.filter((c) => !keys.includes(c));
  if (missing.length) {
    throw new Error(`The report config has no ${missing.join(' or ')} column, so sync cannot name senders or key payouts. Apply the new config first: ${CONFIG_STEP}. Then run sync again.`);
  }
}

// HTTP 203 means "could not create it, ask again" (Mercado Pago docs).
async function requestReport(api, ym, sleep) {
  for (let attempt = 1; ; attempt += 1) {
    const res = await api.create(ym);
    if (res.status >= 200 && res.status < 300 && res.status !== 203) return null;
    if (res.status === 203 && attempt < 3) {
      await sleep(5000);
      continue;
    }
    return `asking for the report answered HTTP ${res.status}`;
  }
}

// Download, check the D-19 columns, search, enrich, check, save. Returns { name, check, columns } when saved,
// { outdated: [column] } for a report made before the config change, or { error, status? }.
// The raw download is never saved: a file that fails its checks goes to rejected/ without the raw columns.
async function saveReport({ api, folder, ym, report, replaces, hashKey, timeout }) {
  if (!report.file_name) return { error: 'the report is processed but the list gives no file_name' };
  const raw = (await api.download(report.file_name)).toString('utf8');
  const outdated = D19_COLUMNS.filter((c) => !headerOf(raw).includes(c));
  if (outdated.length) return { outdated };
  let payments;
  try {
    payments = await searchPayments({ api, ym, ...(timeout ? { timeout } : {}) });
  } catch (e) {
    if (e instanceof SearchFailed) return { error: e.code, ...(e.status ? { status: e.status } : {}), retry: true };
    throw e;
  }
  const name = syncedName(ym);
  const text = enrichReport(raw, { payments, hashKey: hashKey() });
  let check;
  try {
    check = parseReleaseReport(text, { file: name }).check;
  } catch {
    folder.write(`rejected/${name}`, Buffer.from(text));
    return { error: 'the enriched file does not parse; kept in rejected/ without the raw columns' };
  }
  if (check.month !== ym) {
    folder.write(`rejected/${name}`, Buffer.from(text));
    return { error: `the downloaded file holds ${check.month}; kept in rejected/ without the raw columns` };
  }
  // The old file may have the same name (a plain release-YYYY-MM.csv), so it is set aside first.
  for (const old of replaces) folder.setAside(old, 'replaced');
  folder.write(name, Buffer.from(text));
  return { name, check, columns: columnCheck(raw) };
}

export async function sync({
  api,
  folder,
  from,
  to,
  clock = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
  waitMinutes = 15,
  pollSeconds = 15,
  timeout, // (ms) => AbortSignal for each search request; tests pass a fake
}) {
  await checkConfig(api);
  const plan = planSync({ files: folder.read(), from, to, nowMs: clock() });
  const result = { fetched: [], failed: [], pending: [], setAside: [] };
  for (const u of plan.unreadable) log(`skipped ${u.name}: ${u.reason}`);
  for (const name of plan.stale) {
    folder.setAside(name, 'replaced');
    result.setAside.push(name);
    log(`moved ${name} to replaced/: a full report for its month is already here`);
  }
  if (!plan.months.length) {
    log(`Nothing to fetch: ${plan.start} to ${plan.end} is already downloaded in full.`);
    return result;
  }
  log(`To fetch: ${plan.months.map((m) => (plan.replaces[m].length ? `${m} (replaces a partial or plain file)` : m)).join(', ')}`);

  let key;
  const hashKey = () => (key ??= folder.hashKey());
  let columnsChecked = false;
  const fail = (ym, reason, { status, retry } = {}) => {
    result.failed.push({ month: ym, reason, ...(status ? { status } : {}) });
    log(`${ym}: failed: ${reason}${status ? `, HTTP ${status}` : ''}${retry ? '; nothing saved, the next run tries again' : ''}`);
  };

  // Reports made before the config change are discarded; each month asks for a new one once (D-16).
  const discarded = new Set();
  const renewed = new Set();
  const usable = (list) => list.filter((r) => !discarded.has(r.id ?? r.file_name));

  // Reuse a report that already exists for the month (an earlier run, or the automatic monthly
  // one) and ask only for the rest, so a re-run after a timeout does not pile up new requests.
  let list = usable(reportList(await api.list()));
  const waiting = new Set();
  for (const ym of plan.months) {
    const found = findReport(list, ym);
    if (found && reportState(found) !== 'failed') {
      waiting.add(ym);
      continue;
    }
    const error = await requestReport(api, ym, sleep);
    if (error) fail(ym, error);
    else {
      waiting.add(ym);
      log(`${ym}: report requested`);
    }
  }

  const started = clock();
  const deadline = started + waitMinutes * 60 * 1000;
  let lastNote = started;
  while (waiting.size) {
    list = usable(reportList(await api.list()));
    for (const ym of [...waiting]) {
      const report = findReport(list, ym);
      const state = report ? reportState(report) : 'pending'; // just requested, not listed yet
      if (state === 'pending') continue;
      waiting.delete(ym);
      if (state === 'failed') {
        fail(ym, `Mercado Pago marked the report ${report.status}`);
        continue;
      }
      const saved = await saveReport({ api, folder, ym, report, replaces: plan.replaces[ym], hashKey, timeout });
      if (saved.outdated) {
        if (renewed.has(ym)) {
          fail(ym, 'report_without_d19_columns', { retry: true });
          continue;
        }
        renewed.add(ym);
        // Every report listed for the month now predates the request below, so none of them can hold
        // the new columns: discard them all, or the next poll could pick an older one and fail the month.
        for (let old = report; old; old = findReport(usable(list), ym)) discarded.add(old.id ?? old.file_name);
        const error = await requestReport(api, ym, sleep);
        if (error) fail(ym, error);
        else {
          waiting.add(ym);
          log(`${ym}: the report was made before the config change (no ${saved.outdated.join(', no ')}); asked for a new one`);
        }
      } else if (saved.error) {
        fail(ym, saved.error, saved);
      } else {
        result.fetched.push(ym);
        const c = saved.check;
        const ok = c.balanceBreaks === 0 && c.closingMatches && c.monthNetMatches;
        log(`${ym}: saved ${saved.name}, ${c.operations} operations, balance checks ${ok ? 'pass' : 'FAIL'}`);
        if (!columnsChecked) {
          columnsChecked = true;
          for (const col of saved.columns) log(`column check: ${col.column} ${col.present ? `present, ${col.filled} rows filled` : 'missing'}`);
        }
      }
    }
    if (!waiting.size || clock() >= deadline) break;
    if (clock() - lastNote >= 60 * 1000) {
      lastNote = clock();
      const statuses = [...waiting].map((ym) => `${ym} ${findReport(list, ym)?.status ?? 'not listed yet'}`);
      log(`waiting ${Math.round((lastNote - started) / 60000)} min: ${statuses.join(', ')}`);
    }
    await sleep(pollSeconds * 1000);
  }
  for (const ym of waiting) {
    const status = findReport(list, ym)?.status ?? 'not listed yet';
    result.pending.push(ym);
    log(`${ym}: still being generated (status: ${status}). Run sync again later; it picks up this report.`);
  }
  return result;
}
