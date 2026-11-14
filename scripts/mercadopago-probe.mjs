// Probe: can Mercado Pago's Payments API name the other party of the operations in a month's
// release report? It searches that month's payments two ways (you as payer, you as collector), matches them to the report's operations by id, looks up a few unmatched ones one by one,
// and prints counts, field names and enumerated values only, never names, ids, emails or amounts.
//
//   node scripts/mercadopago-report.mjs probe 2026-10
import { parseReleaseReport } from '../apps/api/src/ingest/mercadopago.mjs';
import { monthBounds, syncedName } from './mercadopago-sync.mjs';

// Where the other party's name or the merchant could be. Every filled field under these is counted.
export const NAME_PREFIXES = [
  'description',
  'statement_descriptor',
  'payer.',
  'collector.',
  'additional_info.items',
  'point_of_interaction.transaction_data.bank_info',
  'point_of_interaction.transaction_data.commerce',
  'point_of_interaction.business_info',
  'metadata',
];
// Enumerations: their values are types, not personal data, so they are printed. The merchant
// category code (MCC) is a 4-digit store type, for example 5812 for restaurants.
const ENUMS = ['operation_type', 'payment_type_id', 'point_of_interaction.type', 'point_of_interaction.transaction_data.commerce.mcc', 'status'];
const KINDS = ['expense', 'transfer_out', 'inflow', 'interest', 'refund'];

const at = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const filled = (v) => v !== undefined && v !== null && v !== '' && !(typeof v === 'object' && Object.keys(v).length === 0);
const enumValue = (v) => (typeof v === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(v)) || /^\d{4}$/.test(String(v)) ? String(v) : 'other';
const brief = (res) => (res.text ?? '').replace(/\s+/g, ' ').slice(0, 150);

// Every filled key path down to `depth`, names only; array items fold into "[]".
export function keyPaths(obj, depth = 4, prefix = '', out = new Set()) {
  if (depth === 0 || obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const item of obj.slice(0, 3)) keyPaths(item, depth, `${prefix}[]`, out);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (filled(v)) out.add(p);
    keyPaths(v, depth - 1, p, out);
  }
  return out;
}

// Per report kind and operation type: how many payments, how many have each name field filled,
// how many different descriptions there are (all alike means a generic text, mostly different means
// names or merchants), and the type values seen.
export function summarize(payments, kindOf) {
  const byKind = {};
  for (const p of payments) {
    const kind = `${kindOf.get(String(p.id)) ?? 'not in report'} / ${enumValue(p.operation_type ?? 'none')}`;
    const g = (byKind[kind] ??= { count: 0, fields: {}, enums: {}, descriptions: new Set() });
    g.count += 1;
    for (const f of keyPaths(p, 8)) {
      if (NAME_PREFIXES.some((pre) => f === pre || f.startsWith(pre.endsWith('.') ? pre : `${pre}.`) || f.startsWith(`${pre}[]`))) {
        g.fields[f] = (g.fields[f] ?? 0) + 1;
      }
    }
    if (filled(p.description)) g.descriptions.add(String(p.description).trim().toLowerCase());
    for (const e of ENUMS.slice(1)) {
      const v = at(p, e);
      if (v == null) continue;
      const key = `${e.split('.').at(-1)}=${enumValue(v)}`;
      g.enums[key] = (g.enums[key] ?? 0) + 1;
    }
  }
  return byKind;
}

function printSummary(byKind, log) {
  for (const [kind, g] of Object.entries(byKind).sort()) {
    log(`    ${kind}: ${g.count}, ${g.descriptions.size} different descriptions`);
    const fields = Object.entries(g.fields)
      .filter(([f]) => !Object.keys(g.fields).some((other) => other !== f && other.startsWith(`${f}.`)))
      .sort()
      .map(([f, n]) => `${f} ${n}`);
    log(`      filled: ${fields.length ? fields.join(', ') : 'none'}`);
    log(`      types: ${Object.entries(g.enums).sort().map(([e, n]) => `${e} ${n}`).join(', ') || 'none'}`);
  }
}

async function searchAll(api, { begin, end, filter }) {
  const results = [];
  let total = 0;
  for (let offset = 0; offset < 2000; offset += 50) {
    const q = new URLSearchParams({ sort: 'date_created', criteria: 'asc', range: 'date_created', begin_date: begin, end_date: end, limit: '50', offset: String(offset) });
    const res = await api.get(`/v1/payments/search?${q}${filter ? `&${filter}` : ''}`);
    if (res.status !== 200) return { status: res.status, total, results, error: brief(res) };
    total = res.data?.paging?.total ?? 0;
    const page = res.data?.results ?? [];
    results.push(...page);
    if (page.length < 50 || results.length >= total) break;
  }
  return { status: 200, total, results };
}

export async function probe({ api, files, ym, log = console.log }) {
  const file =
    files.find((f) => f.name === syncedName(ym)) ??
    files.find((f) => {
      try {
        return parseReleaseReport(f.text, { file: f.name }).check.month === ym;
      } catch {
        return false;
      }
    });
  if (!file) throw new Error(`No release report for ${ym} on disk. Run sync first.`);
  const { transactions } = parseReleaseReport(file.text, { file: file.name });
  const kindOf = new Map(transactions.map((t) => [t.source_ref.split('#').at(-1), t.kind]));
  const reportKinds = (ids) =>
    KINDS.map((k) => `${k} ${[...ids].filter((id) => kindOf.get(id) === k).length}/${[...kindOf.values()].filter((v) => v === k).length}`).join(', ');
  log(`Report ${ym}: ${kindOf.size} operations (${reportKinds(kindOf.keys()).replace(/ \d+\//g, ' ')})`);
  log('Only counts, field names and type values are printed.\n');

  const me = await api.get('/users/me');
  if (me.status !== 200 || !me.data?.id) throw new Error(`GET /users/me answered HTTP ${me.status} ${brief(me)}`);
  const myId = me.data.id;

  // A payment can be created a few days before the report releases it, so start a week early.
  const { first, last } = monthBounds(ym);
  const begin = new Date(Date.parse(`${first}T00:00:00.000-03:00`) - 7 * 864e5).toISOString();
  const end = new Date(Date.parse(`${last}T23:59:59.999-03:00`)).toISOString();

  const found = new Set();
  for (const [label, filter] of [
    ['you as payer', `payer.id=${myId}`],
    ['you as collector', `collector.id=${myId}`],
  ]) {
    const r = await searchAll(api, { begin, end, filter });
    if (r.error) {
      log(`search, ${label}: HTTP ${r.status} ${r.error}`);
      continue;
    }
    const ids = new Set(r.results.map((p) => String(p.id)).filter((id) => kindOf.has(id)));
    ids.forEach((id) => found.add(id));
    log(`search, ${label}: ${r.total} payments, ${r.results.length} read; report operations matched: ${reportKinds(ids)}`);
    printSummary(summarize(r.results, kindOf), log);
  }

  // A few report operations no search returned, looked up by id.
  log('\nlookup by id, for operations no search returned:');
  for (const kind of ['expense', 'transfer_out', 'inflow']) {
    const sample = [...kindOf].filter(([id, k]) => k === kind && !found.has(id)).slice(0, 3);
    if (!sample.length) {
      log(`  ${kind}: none left to look up`);
      continue;
    }
    const statuses = [];
    const payments = [];
    for (const [id] of sample) {
      const res = await api.get(`/v1/payments/${encodeURIComponent(id)}`);
      statuses.push(res.status);
      if (res.status === 200 && res.data) {
        payments.push(res.data);
      }
    }
    log(`  ${kind}: HTTP ${statuses.join(', ')}`);
    if (payments.length) printSummary(summarize(payments, kindOf), log);
  }

  return { found: found.size, operations: kindOf.size };
}
