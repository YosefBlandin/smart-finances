// Free-text monthly log kept in Notion (Sep 2024 to Jun 2025), amounts in USD.
//
// Format, as written by hand:
//   Sep - 2024            month header; only the first one carries a year
//   October:              later headers; the year rolls over at January
//   - Food: 18$           one expense per line, the bullet is optional, the colon too
//   income: / expenses    switch between income lines ("1200 USD") and expense lines
//   AR                    from here on the money was spent in Argentina (before: Venezuela)
// Days are never recorded, so every row is month-precision.
import { batchId, hashId, toCents } from './schema.mjs';
import { categoryFor } from './categories.mjs';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthIndex = (word) => MONTHS.findIndex((m) => m.startsWith(word.toLowerCase()) && word.length >= 3);

const NUMBER = /\d+(?:[.,]\d+)?/g;

// Turns the amount part of a line into cents. Handles "23$ + 12$", "100 + Products: 54$"
// (summed) and "320$ - 30$ = 290,00$" (the written result wins).
function parseAmount(rest) {
  if (rest.includes('=')) return { cents: toCents(rest.split('=').at(-1).replace(/[$\s]/g, '')), summed: true };
  const numbers = rest.match(NUMBER) ?? [];
  if (numbers.length === 0) return null;
  return { cents: numbers.reduce((s, n) => s + toCents(n), 0), summed: numbers.length > 1 };
}

function kindFor(label) {
  const l = label.toLowerCase();
  if (l.includes('lending')) return { kind: 'loan_out', category: 'Loans' };
  // Loading a Venezuelan wallet moves money, it does not spend it.
  if (l === 'zinli') return { kind: 'transfer_out', category: 'Transfers', flags: ['needs_review'] };
  if (l === 'changing usd to bs') return { kind: 'expense', category: 'Fees & admin', flags: ['assumed_fee'] };
  if (l === 'cash') return { kind: 'expense', category: 'Cash', flags: ['cash_untracked'] };
  return { kind: 'expense', category: categoryFor(label) };
}

export function parseNotionLog(text, { file = 'notion' } = {}) {
  const import_batch = batchId('notion', text);
  const transactions = [];
  const issues = [];
  const seen = new Map(); // identical lines in one month are separate purchases
  let ym = null;
  let section = 'expense';
  let country = 'VE';

  text.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim().replace(/^-\s*/, '').trim();
    if (!line) return;

    const header = /^([a-z]+)\s*(?:-\s*(\d{4}))?\s*:?$/i.exec(line);
    if (header && monthIndex(header[1]) >= 0) {
      const month = monthIndex(header[1]) + 1;
      if (header[2]) ym = { year: Number(header[2]), month };
      else if (ym) ym = { year: ym.year + (month < ym.month ? 1 : 0), month };
      else issues.push({ lineNo, line, issue: 'month header without a year before any dated header' });
      section = 'expense';
      return;
    }
    if (/^income:?$/i.test(line)) return void (section = 'income');
    if (/^expenses:?$/i.test(line)) return void (section = 'expense');
    if (line === 'AR') {
      country = 'AR';
      issues.push({ lineNo, line, issue: 'country marker: rows after this are in Argentina', info: true });
      return;
    }
    if (!ym) return void issues.push({ lineNo, line, issue: 'line before the first month header, skipped' });

    const date = `${ym.year}-${String(ym.month).padStart(2, '0')}-01`;
    let entry;
    if (section === 'income') {
      const m = /^(\d+(?:[.,]\d+)?)\s*USD$/i.exec(line);
      if (!m) return void issues.push({ lineNo, line, issue: 'income line not understood, skipped' });
      entry = { label: 'Income', kind: 'income', category: 'Income', cents: toCents(m[1]), flags: [] };
    } else {
      const m = /^(.*?)\s*:?\s*(\d.*)$/.exec(line);
      const amount = m && parseAmount(m[2]);
      if (!amount) return void issues.push({ lineNo, line, issue: 'expense line not understood, skipped' });
      const label = m[1].replace(/:\s*$/, '').trim();
      const k = kindFor(label);
      const flags = [...(k.flags ?? [])];
      if (amount.summed) flags.push('summed');
      if (/\bBCV\b/.test(m[2])) flags.push('bcv_rate');
      if (k.category === 'Uncategorized') flags.push('needs_review');
      entry = { label, kind: k.kind, category: k.category, cents: -amount.cents, flags };
      if (amount.summed || flags.includes('bcv_rate')) issues.push({ lineNo, line, issue: flags.join(', '), info: true });
    }

    const key = `${date}␟${line.toLowerCase()}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    transactions.push({
      id: hashId('notion', date, line.toLowerCase(), occurrence),
      date,
      date_precision: 'month',
      kind: entry.kind,
      amount: entry.cents,
      currency: 'USD',
      category: entry.category,
      merchant: '',
      description_raw: line,
      source: 'notion',
      source_ref: `${file}:${lineNo}`,
      country,
      flags: entry.flags,
      import_batch,
    });
  });

  return { transactions, issues };
}
