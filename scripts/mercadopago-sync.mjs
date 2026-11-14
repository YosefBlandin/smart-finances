// Sync for the Mercado Pago "released money" report: finds the months that data/real/mercadopago/
// does not hold in full, asks Mercado Pago for each one, waits until it is generated, downloads it
// and checks that it parses as that month. scripts/mercadopago-report.mjs runs it; see the comment
// there for the token. Network, disk and clock come in as arguments, so the tests use fakes.
//
// Logs carry months, file names, counts and HTTP statuses only, never amounts or report content.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseReleaseReport } from '../apps/api/src/ingest/mercadopago.mjs';

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

// Whether a file holds its month in full. A file sync wrote asked for the whole month after it
// ended. Any other file counts only if the date in Mercado Pago's file name (…-YYYY-MM-DD-HHMMSS.csv,
// when the report was generated) is on or after the 2nd of the next month; the extra day covers not
// knowing that stamp's time zone. A file with no such stamp counts as full.
export function holdsFullMonth(name, month) {
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
      unreadable.push({ name, reason: e.message });
      continue;
    }
    if (holdsFullMonth(name, month)) full.set(month, name);
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
  async function call(method, suffix, body) {
    const res = await fetchImpl(suffix.startsWith('https://') ? suffix : `${BASE}${suffix}`, {
      method,
      headers: { ...auth, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
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
    get: (apiPath) => call('GET', `https://api.mercadopago.com${apiPath}`),
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

const brief = (res) => (res.text ?? '').replace(/\s+/g, ' ').slice(0, 200);

function reportList(res) {
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Mercado Pago refused the token (HTTP ${res.status}). Check MP_ACCESS_TOKEN.`);
  }
  if (res.status !== 200) throw new Error(`listing reports answered HTTP ${res.status} ${brief(res)}`);
  const list = Array.isArray(res.data) ? res.data : res.data?.results;
  if (!Array.isArray(list)) throw new Error('listing reports did not return a list');
  return list;
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
    return `asking for the report answered HTTP ${res.status} ${brief(res)}`.trim();
  }
}

async function saveReport({ api, folder, ym, report, replaces }) {
  if (!report.file_name) return { error: 'the report is processed but the list gives no file_name' };
  const buf = await api.download(report.file_name);
  const name = syncedName(ym);
  let check;
  try {
    check = parseReleaseReport(buf.toString('utf8'), { file: name }).check;
  } catch (e) {
    folder.write(`rejected/${name}`, buf);
    return { error: `the downloaded file does not parse (${e.message}); kept in rejected/` };
  }
  if (check.month !== ym) {
    folder.write(`rejected/${name}`, buf);
    return { error: `the downloaded file holds ${check.month}; kept in rejected/` };
  }
  folder.write(name, buf);
  for (const old of replaces) folder.setAside(old, 'replaced');
  return { name, check };
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
}) {
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
  log(`To fetch: ${plan.months.map((m) => (plan.replaces[m].length ? `${m} (replaces a partial file)` : m)).join(', ')}`);

  // Reuse a report that already exists for the month (an earlier run, or the automatic monthly
  // one) and ask only for the rest, so a re-run after a timeout does not pile up new requests.
  let list = reportList(await api.list());
  const waiting = new Set();
  for (const ym of plan.months) {
    const found = findReport(list, ym);
    if (found && reportState(found) !== 'failed') {
      waiting.add(ym);
      continue;
    }
    const error = await requestReport(api, ym, sleep);
    if (error) {
      result.failed.push({ month: ym, reason: error });
      log(`${ym}: ${error}`);
    } else {
      waiting.add(ym);
      log(`${ym}: report requested`);
    }
  }

  const started = clock();
  const deadline = started + waitMinutes * 60 * 1000;
  let lastNote = started;
  while (waiting.size) {
    list = reportList(await api.list());
    for (const ym of [...waiting]) {
      const report = findReport(list, ym);
      const state = report ? reportState(report) : 'pending'; // just requested, not listed yet
      if (state === 'pending') continue;
      waiting.delete(ym);
      const saved =
        state === 'failed'
          ? { error: `Mercado Pago marked the report ${report.status}` }
          : await saveReport({ api, folder, ym, report, replaces: plan.replaces[ym] });
      if (saved.error) {
        result.failed.push({ month: ym, reason: saved.error });
        log(`${ym}: ${saved.error}`);
      } else {
        result.fetched.push(ym);
        const c = saved.check;
        const ok = c.balanceBreaks === 0 && c.closingMatches && c.monthNetMatches;
        log(`${ym}: saved ${saved.name}, ${c.operations} operations, balance checks ${ok ? 'pass' : 'FAIL'}`);
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
