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

  // A row filed in one month but dated in another may also have been entered in the month
  // it is dated. Flag it when that month has the same description and amount on that exact
  // day; it stays in, because the month's own Summary counted it.
  const possibleDuplicates = [];
  for (const issue of results.flatMap((r) => r.issues ?? []).filter((i) => i.statedDate)) {
    const twin = transactions.find(
      (t) => t.date_precision === 'day' && t.date === issue.statedDate && t.amount === issue.amount && t.description_raw.toLowerCase() === issue.description.toLowerCase(),
    );
    const row = twin && transactions.find((t) => t.source_ref.startsWith(`${issue.ref} `));
    if (row) {
      row.flags.push('possible_duplicate');
      possibleDuplicates.push({ row, twin });
    }
  }
  return { transactions, duplicates, possibleDuplicates };
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

const cellOf = (t) => t.source_ref.replace(/ \([^)]*\)$/, '');

function excelSection(excel, all, possible) {
  if (excel.length === 0) return ['No budget workbooks found.', ''];
  const out = [
    '| Month | Rows | Day known | Day/month swapped (fixed) | No date | Date in another month | Expenses | Summary | Not in Summary | OK | Income | Summary | Not in Summary | OK |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { check: c } of [...excel].sort((a, b) => a.check.month.localeCompare(b.check.month))) {
    const e = c.expense;
    const i = c.income;
    out.push(
      `| ${c.month} | ${c.rows} | ${c.dates.day} | ${c.dates.swapped} | ${c.dates.missing} | ${c.dates.conflict} | ${fromCents(e.total)} | ${fromCents(e.summaryTotal)} | ${fromCents(e.unlisted)} | ${ok(e.matches)} | ${fromCents(i.total)} | ${fromCents(i.summaryTotal)} | ${fromCents(i.unlisted)} | ${ok(i.matches)} |`,
    );
  }
  out.push(
    '',
    'OK means the Summary sheet total plus the rows it cannot see (blank or unlisted category) equals every row imported.',
    'Rows without a usable day keep the file month with date_precision = month.',
    '',
    monthlyTable(all, 'excel'),
    '',
  );
  const issues = excel.flatMap((r) => r.issues);
  const problems = issues.filter((x) => !x.info);
  out.push(`**Rows skipped:** ${problems.length === 0 ? 'none' : ''}`);
  for (const x of problems) out.push(`- ${x.ref}: \`${x.line}\` (${x.issue})`);
  out.push('', `**Possible double entries** (flagged possible_duplicate, still counted): ${possible.length === 0 ? 'none' : ''}`);
  for (const { row, twin } of possible) out.push(`- ${cellOf(row)} \`${row.description_raw} ${fromCents(row.amount)}\` also at ${cellOf(twin)} on ${twin.date}`);
  out.push('', `**Dates outside the file month** (${issues.filter((x) => x.info).length}):`);
  for (const x of issues.filter((y) => y.info)) out.push(`- ${x.ref}: \`${x.line}\` (${x.issue})`);
  out.push('');
  return out;
}

export function buildReport({ mercadopago = [], notion = [], excel = [], combined, generatedAt = new Date().toISOString() }) {
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

  out.push('## Budget workbooks (Excel)', '', ...excelSection(excel, all, combined.possibleDuplicates ?? []));

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
