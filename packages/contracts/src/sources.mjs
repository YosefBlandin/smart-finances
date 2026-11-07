// Import sources: the file name rule and size cap of each (POST /imports), and the check the API makes. Kept apart from
// routes.mjs, and free of zod, so the browser's own check adds no schema library to the page (T-WEB-17 budget).

const MiB = 1024 * 1024;
const MONTH_NAMES = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const csv = { extension: '.csv', pattern: /^[^/\\]+\.csv$/i, maxBytes: 5 * MiB };
export const SOURCES = {
  mercadopago: csv,
  csv,
  notion: { extension: '.md', pattern: /^[^/\\]+\.md$/i, maxBytes: 5 * MiB },
  excel: { extension: '.xlsx', pattern: new RegExp(`^[^/\\\\]+_(${MONTH_NAMES})_\\d{4}\\.xlsx$`, 'i'), maxBytes: 20 * MiB },
};

// The same checks the API makes, so the web can say what is wrong before it uploads anything.
export function checkImportRequest({ source, file_name, size }) {
  const rule = Object.hasOwn(SOURCES, source) ? SOURCES[source] : null;
  if (!rule) return { ok: false, code: 'bad_request', message: 'Unknown source.' };
  if (!Number.isInteger(size) || size < 1) return { ok: false, code: 'bad_request', message: 'The file is empty.' };
  if (typeof file_name !== 'string' || !rule.pattern.test(file_name)) return { ok: false, code: 'bad_request', message: `The file name does not fit this source (${rule.extension}).` };
  if (size > rule.maxBytes) return { ok: false, code: 'too_large', message: `The file is over ${rule.maxBytes / MiB} MiB.` };
  return { ok: true };
}

