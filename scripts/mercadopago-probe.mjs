// Probe: can Mercado Pago's Payments API name the other party of the operations in a month's
// release report? It searches that month's payments two ways (you as payer, you as collector), matches them to the report's operations by id, looks up a few unmatched ones one by one,
// and prints counts, field names and enumerated values only, never names, ids, emails or amounts.
//
//   node scripts/mercadopago-report.mjs probe 2026-10
import { parseReleaseReport } from '../apps/api/src/ingest/mercadopago.mjs';
import { SearchFailed, searchPayments, syncedName } from './mercadopago-sync.mjs';

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

// Error lines carry the code and the HTTP status only, never a response body (AC-10).
export async function probe({ api, files, ym, log = console.log, timeout }) {
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

  // Sync's search: you as payer and as collector, from a week before the month, 30 s per request.
  const found = new Set();
  let searched = { asPayer: [], asCollector: [] };
  try {
    searched = await searchPayments({ api, ym, ...(timeout ? { timeout } : {}) });
  } catch (e) {
    if (!(e instanceof SearchFailed)) throw e;
    // /users/me answering 401 or 403 means the token: stop, as sync does.
    if (e.status === 401 || e.status === 403) throw new Error(`Mercado Pago refused the token (HTTP ${e.status}). Check MP_ACCESS_TOKEN.`);
    log(`search: failed: ${e.message}`);
  }
  for (const [label, results] of [
    ['you as payer', searched.asPayer],
    ['you as collector', searched.asCollector],
  ]) {
    const ids = new Set(results.map((p) => String(p.id)).filter((id) => kindOf.has(id)));
    ids.forEach((id) => found.add(id));
    log(`search, ${label}: ${results.length} payments read; report operations matched: ${reportKinds(ids)}`);
    printSummary(summarize(results, kindOf), log);
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
