// Monthly budget workbooks (Jul 2025 to May 2026), one file per month, amounts in USD.
//
// Layout, from the budget template they were made with:
//   Transactions!B:E  expenses: Date, Amount, Description, Category (data from row 5)
//   Transactions!G:J  income, same four columns
//   Summary!B27:B44   expense categories, Summary!H27:H44 income categories
//   Summary!E26, K26  actual expense and income totals (SUMIF over those categories)
// The month comes from the file name (…_AUG_2025.xlsx), because dates inside are unreliable:
// many were typed day-first into a month-first sheet (12/08 stored as December 8), some are
// text, some point at other months, and from Feb 2026 most are missing.
import { readWorkbook } from './xlsx.mjs';
import { categoryFor } from './categories.mjs';
import { batchId, hashId } from './schema.mjs';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SIDES = [
  { side: 'expense', cols: ['B', 'C', 'D', 'E'], total: 'E26', categories: 'B' },
  { side: 'income', cols: ['G', 'H', 'I', 'J'], total: 'K26', categories: 'H' },
];

// The sheet's own categories mapped onto the shared ones. Vague ones are refined from the
// description when a description rule knows better (RENT filed under Home is housing).
const SHEET_CATEGORIES = {
  food: 'Groceries',
  'food out': 'Dining out',
  transportation: 'Transport',
  'health/medical': 'Health & fitness',
  home: 'Home',
  personal: 'Personal care',
  pets: 'Pets',
  utilities: 'Housing & utilities',
  travel: 'Travel',
  debt: 'Debt payments',
  gifts: 'Gifts',
};
const REFINE = new Set(['home', 'personal', 'utilities', 'debt', 'other', '']);

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const cents = (v) => Math.round(Number(v) * 100);

// Returns { day, flag, note } where day is null when only the month is known.
export function resolveDate(raw, year, month) {
  if (raw == null || String(raw).trim() === '') return { day: null, flag: 'no_date' };
  const s = String(raw).trim();
  let y;
  let a; // first number as written / stored month
  let b; // second number
  if (/^\d+(\.0+)?$/.test(s)) {
    // Excel serial: days since 1899-12-30. Stored month-first, so a day-first entry
    // ends up with the real day in the month slot.
    const d = new Date(Date.UTC(1899, 11, 30) + Number.parseInt(s, 10) * 86400000);
    y = d.getUTCFullYear();
    [a, b] = [d.getUTCDate(), d.getUTCMonth() + 1]; // as (day, month)
    if (y === year && b === month) return { day: a };
    if (y === year && a === month && b <= daysIn(year, month)) return { day: b, flag: 'day_month_swapped' };
    return { day: null, flag: 'date_conflict', note: d.toISOString().slice(0, 10), iso: d.toISOString().slice(0, 10) };
  }
  const m = /^(\d{1,2})\/+(\d{1,2})\/*(\d{4})$/.exec(s); // day-first, tolerating 21//08/2025 and 6/92025
  if (!m) return { day: null, flag: 'date_conflict', note: s };
  [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const iso = `${y}-${pad(b)}-${pad(a)}`;
  if (y === year && b === month && a >= 1 && a <= daysIn(year, month)) return { day: a };
  if (y === year && a === month && b >= 1 && b <= daysIn(year, month)) return { day: b, flag: 'day_month_swapped' };
  return { day: null, flag: 'date_conflict', note: s, iso };
}

function classify(side, description, sheetCategory) {
  const key = sheetCategory.trim().toLowerCase();
  if (side === 'income') {
    if (key === 'paycheck' || key === 'bonus') return { kind: 'income', category: 'Income', flags: [] };
    if (key === 'interest') return { kind: 'interest', category: 'Interest', flags: [] };
    if (key === 'savings') return { kind: 'inflow', category: 'Transfers', flags: ['needs_review'] };
    // "Other" income in these files includes a partner's share of the rent.
    return { kind: 'income', category: 'Income', flags: ['needs_review'] };
  }
  const fromDescription = categoryFor(description);
  let category = SHEET_CATEGORIES[key] ?? 'Uncategorized';
  if (REFINE.has(key) && fromDescription !== 'Uncategorized') category = fromDescription;
  return { kind: 'expense', category, flags: category === 'Uncategorized' ? ['needs_review'] : [] };
}

export function parseBudgetWorkbook(buf, { file }) {
  const fm = /([A-Z]{3})_(\d{4})\.xlsx$/i.exec(file ?? '');
  const month = fm ? MONTHS.indexOf(fm[1].toUpperCase()) + 1 : 0;
  if (!month) throw new Error(`${file}: cannot tell the month from the file name (expected …_MMM_YYYY.xlsx)`);
  const year = Number(fm[2]);
  const ym = `${year}-${pad(month)}`;

  const sheets = readWorkbook(buf);
  const t = sheets.Transactions;
  const summary = sheets.Summary;
  if (!t || !summary) throw new Error(`${file}: expected Transactions and Summary sheets`);
  if (['B4', 'C4', 'D4', 'E4'].map((c) => t[c]).join('|') !== 'Date|Amount|Description|Category') {
    throw new Error(`${file}: Transactions header is not Date | Amount | Description | Category at B4:E4`);
  }

  const import_batch = batchId('excel', buf.toString('base64'));
  const lastRow = Math.max(...Object.keys(t).map((ref) => Number(/\d+/.exec(ref)[0])));
  const transactions = [];
  const issues = [];
  const seen = new Map();
  const check = { file, month: ym, rows: 0, dates: { day: 0, swapped: 0, missing: 0, conflict: 0 } };

  for (const { side, cols, total, categories } of SIDES) {
    const listed = new Set();
    for (let r = 27; r <= 44; r += 1) if (summary[`${categories}${r}`]) listed.add(summary[`${categories}${r}`].toLowerCase());
    let sum = 0;
    let unlisted = 0;

    for (let r = 5; r <= lastRow; r += 1) {
      const [dateRaw, amountRaw, descRaw, catRaw] = cols.map((c) => t[`${c}${r}`]);
      if (amountRaw == null && descRaw == null && catRaw == null && dateRaw == null) continue;
      const cell = `${file}#Transactions!${cols[0]}${r}`;
      if (amountRaw == null || !Number.isFinite(Number(amountRaw))) {
        issues.push({ ref: cell, line: [dateRaw, amountRaw, descRaw, catRaw].filter(Boolean).join(' | '), issue: `${side} row without a numeric amount, skipped` });
        continue;
      }
      const amount = cents(amountRaw);
      const description = (descRaw ?? '').trim();
      const sheetCategory = catRaw ?? '';
      sum += amount;
      if (!listed.has(sheetCategory.toLowerCase())) unlisted += amount;

      const date = resolveDate(dateRaw, year, month);
      const { kind, category, flags } = classify(side, description, sheetCategory);
      if (date.flag) flags.push(date.flag);
      check.rows += 1;
      check.dates[date.day ? (date.flag ? 'swapped' : 'day') : date.flag === 'no_date' ? 'missing' : 'conflict'] += 1;

      const signed = side === 'expense' ? -amount : amount;
      if (date.flag === 'date_conflict') {
        issues.push({ ref: cell, line: `${description} ${amountRaw}`, issue: `date ${date.note} is outside ${ym}; kept in ${ym} without a day`, info: true, statedDate: date.iso, amount: signed, description });
      }
      const key = [ym, side, description.toLowerCase(), sheetCategory.toLowerCase(), amount, String(dateRaw ?? '')].join('␟');
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      transactions.push({
        id: hashId('excel', key, occurrence),
        date: `${ym}-${pad(date.day ?? 1)}`,
        date_precision: date.day ? 'day' : 'month',
        kind,
        amount: signed,
        currency: 'USD',
        category,
        merchant: '',
        description_raw: description,
        source: 'excel',
        source_ref: `${cell} (${sheetCategory || 'no category'})`,
        country: 'AR',
        flags,
        import_batch,
      });
    }

    // The Summary only counts rows whose category is in its list, so the sheet total plus
    // the unlisted rows must equal everything the importer read.
    const summaryTotal = cents(summary[total] ?? 0);
    check[side] = { total: sum, summaryTotal, unlisted, matches: sum - unlisted === summaryTotal };
  }

  return { transactions, issues, check };
}
