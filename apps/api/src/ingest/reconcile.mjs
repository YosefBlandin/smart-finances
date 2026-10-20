// Combines importer output, drops rows already seen (same id), and writes a Markdown report
// that says what was proven, what was assumed and what still needs a human.
import { fromCents } from './schema.mjs';

const ok = (b) => (b ? 'yes' : '**NO**');
const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

export function combine(results) {
  const byId = new Map();
  let duplicates = 0;
  for (const t of results.flatMap((r) => r.transactions)) {
    if (byId.has(t.id)) duplicates += 1;
    else byId.set(t.id, t);
  }
  const transactions = [...byId.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source) || a.source_ref.localeCompare(b.source_ref),
  );
  return { transactions, duplicates };
}

function monthlyTable(transactions, source) {
  const months = new Map();
  for (const t of transactions.filter((x) => x.source === source)) {
    const ym = t.date.slice(0, 7);
    const m = months.get(ym) ?? { rows: 0, currency: t.currency, byKind: {} };
    m.rows += 1;
    m.byKind[t.kind] = (m.byKind[t.kind] ?? 0) + t.amount;
    months.set(ym, m);
  }
  const kinds = [...new Set([...months.values()].flatMap((m) => Object.keys(m.byKind)))].sort();
  const lines = [`| Month | Rows | Currency | ${kinds.join(' | ')} |`, `|---|---|---|${kinds.map(() => '---|').join('')}`];
  for (const [ym, m] of [...months].sort()) {
    lines.push(`| ${ym} | ${m.rows} | ${m.currency} | ${kinds.map((k) => (k in m.byKind ? fromCents(m.byKind[k]) : '')).join(' | ')} |`);
  }
  return lines.join('\n');
}

export function buildReport({ mercadopago = [], notion = [], combined, generatedAt = new Date().toISOString() }) {
  const out = [`# Import reconciliation`, '', `Generated ${generatedAt}. Local only: this file lives in git-ignored data/real/clean/.`, ''];
  const all = combined.transactions;

  out.push('## Mercado Pago (release report)', '');
  if (mercadopago.length === 0) out.push('No release reports found.', '');
  else {
    const checks = mercadopago.map((r) => r.check).sort((a, b) => a.month.localeCompare(b.month));
    out.push(
      '| Month | File | Rows | Outside month | Operations | Zero-net | Opening | Month end | Running balance OK | Closing OK | Kept rows explain month |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
    );
    for (const c of checks) {
      out.push(
        `| ${c.month} | ${c.file} | ${c.rows} | ${c.rowsOutsideMonth} | ${c.operations} | ${c.zeroNetOperations} | ${fromCents(c.opening)} | ${fromCents(c.monthEnd)} | ${ok(c.balanceBreaks === 0)} | ${ok(c.closingMatches)} | ${ok(c.monthNetMatches)} |`,
      );
    }
    out.push('', '**Chain between months** (each opening must equal the previous month end):', '');
    for (let i = 1; i < checks.length; i += 1) {
      const prev = checks[i - 1];
      const cur = checks[i];
      if (cur.month === prev.month) out.push(`- ${cur.month}: **two reports for the same month** (${prev.file}, ${cur.file}); duplicates were dropped by id`);
      else if (cur.month !== nextMonth(prev.month)) out.push(`- **Gap** between ${prev.month} and ${cur.month}: no report for the months in between`);
      else out.push(`- ${prev.month} → ${cur.month}: ${ok(cur.opening === prev.monthEnd)} (${fromCents(prev.monthEnd)} → ${fromCents(cur.opening)})`);
    }
    out.push('', monthlyTable(all, 'mercadopago'), '');
    out.push(
      'Notes: one row per operation (SOURCE_ID), net of its reserve rows. The report has no merchant names, so most',
      'expenses are Uncategorized. `transfer_out` (payouts) and `inflow` rows are flagged needs_review: they can be',
      'transfers between your own accounts or payments to and from people.',
      '',
    );
  }

  out.push('## Notion log', '');
  if (notion.length === 0) out.push('No Notion log found.', '');
  else {
    out.push(monthlyTable(all, 'notion'), '');
    const issues = notion.flatMap((r) => r.issues);
    const problems = issues.filter((i) => !i.info);
    out.push(`**Lines skipped:** ${problems.length === 0 ? 'none' : ''}`);
    for (const i of problems) out.push(`- line ${i.lineNo}: \`${i.line}\` (${i.issue})`);
    out.push('', '**Lines handled by a rule:**');
    for (const i of issues.filter((x) => x.info)) out.push(`- line ${i.lineNo}: \`${i.line}\` (${i.issue})`);
    out.push('');
  }

  const review = all.filter((t) => t.flags.includes('needs_review'));
  const byCategory = new Map();
  for (const t of all.filter((x) => x.kind === 'expense')) {
    const key = `${t.category} (${t.currency})`;
    byCategory.set(key, (byCategory.get(key) ?? 0) + t.amount);
  }
  out.push(
    '## Totals',
    '',
    `- Transactions written: ${all.length}`,
    `- Duplicates dropped across files: ${combined.duplicates}`,
    `- Flagged needs_review: ${review.length} (${[...new Set(review.map((t) => t.source))].join(', ') || 'none'})`,
    '',
    '| Expense category | Total |',
    '|---|---|',
    ...[...byCategory].sort((a, b) => a[1] - b[1]).map(([k, v]) => `| ${k} | ${fromCents(v)} |`),
    '',
    'ARS and USD are kept in their original currencies; nothing is converted yet.',
    '',
  );
  return out.join('\n');
}
