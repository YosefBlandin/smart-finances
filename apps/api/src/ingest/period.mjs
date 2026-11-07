// The period a file covers (D-16): payments reports and budget workbooks cover one calendar
// month, taken from the importer's own check; a notes log or a generic CSV covers the whole
// file, the period log. An import replaces only the stored rows of its source and period (D-9).

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_SOURCES = new Set(['mercadopago', 'excel']);
const LOG_SOURCES = new Set(['notion', 'csv']);

function monthOf(source, result) {
  const month = result?.check?.month;
  if (typeof month !== 'string' || !MONTH.test(month)) throw new Error(`${source} result has no valid check month`);
  return month;
}

// Returns { period, skipped }. A payments report keeps only its opening month's rows; the rows
// it left out are named in one skipped entry, so nothing is dropped silently.
export function periodOf(source, result) {
  if (LOG_SOURCES.has(source)) return { period: 'log', skipped: [] };
  if (!MONTH_SOURCES.has(source)) throw new Error(`unknown source: ${source}`);
  const period = monthOf(source, result);
  const outside = source === 'mercadopago' ? Number(result.check.rowsOutsideMonth ?? 0) : 0;
  const skipped = outside > 0
    ? [{ where: 'file', reason: `${outside} ${outside === 1 ? 'row' : 'rows'} dated outside ${period} were left out; upload that month's report for them` }]
    : [];
  return { period, skipped };
}
