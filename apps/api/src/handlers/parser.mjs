// parser: runs an upload through its source's importer and into the person's rows
// (architecture.md Contracts "S3 keys", "Parser input", "States and exits"; D-15, D-16, D-32).
// Import mode: an S3 Object Created event from EventBridge for uploads/<sub>/<importId>.
// Reconcile mode: { sub, import_id } of an undo or repair record that already holds the lock.
// Logs carry import ids, outcomes and counts only.
import { parseGenericCsv } from '../ingest/csv.mjs';
import { parseBudgetWorkbook } from '../ingest/excel.mjs';
import { parseReleaseReport } from '../ingest/mercadopago.mjs';
import { parseNotionLog } from '../ingest/notion.mjs';
import { periodOf } from '../ingest/period.mjs';
import { batchId } from '../ingest/schema.mjs';
import { impKey, uploadKey } from '../store/keys.mjs';
import { ConditionFailed } from '../store/memory.mjs';
import { commitImport, FINAL, getImport, reconcile, takeLock } from '../store/imports.mjs';
import { createRepo } from '../store/repo.mjs';

export const MAX_BAD_ROWS = 2000;
const MONTH_SOURCES = new Set(['mercadopago', 'excel']);

export const IMPORTERS = {
  mercadopago: (buf, { file }) => parseReleaseReport(buf.toString('utf8'), { file }),
  notion: (buf, { file }) => parseNotionLog(buf.toString('utf8'), { file }),
  excel: (buf, { file }) => parseBudgetWorkbook(buf, { file }),
  csv: (buf, { file }) => parseGenericCsv(buf.toString('utf8'), { file }),
};

// The existing batch id of each importer, so the same bytes give the same content_hash.
export const contentHash = (source, buf) => (source === 'excel' ? batchId('excel', buf.toString('base64')) : batchId(source, buf.toString('utf8')));

// Test and ops helper: the EventBridge event S3 sends for a new object.
export const objectCreated = (key, time = new Date().toISOString(), bucket = 'bucket') => ({
  version: '0',
  'detail-type': 'Object Created',
  source: 'aws.s3',
  time,
  detail: { bucket: { name: bucket }, object: { key } },
});

const KEY = /^uploads\/([^/#]+)\/([^/#]+)$/;

class Refused extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Parses a file and applies the whole-file rules. Returns { result, period, skipped } or throws Refused.
function readFile(importers, source, buf, file) {
  const importer = importers[source];
  if (!importer) throw new Refused('unknown_source', 'This source has no importer.');
  let result;
  try {
    result = importer(buf, { file });
  } catch (err) {
    throw new Refused('unreadable', String(err?.message ?? 'The file could not be read.').slice(0, 300));
  }
  const issues = result.issues ?? [];
  const bad = issues.filter((i) => !i.info);
  if (bad.length > MAX_BAD_ROWS) throw new Refused('too_many_bad_rows', `${bad.length} rows could not be read; at most ${MAX_BAD_ROWS} may be skipped.`);
  if (result.transactions.length === 0 && bad.length > 0) throw new Refused('unknown_content', 'No row of this file could be read as this source.');
  const { period, skipped: fileSkipped } = periodOf(source, result);
  if (MONTH_SOURCES.has(source) && result.transactions.some((t) => t.date.slice(0, 7) !== period)) {
    throw new Refused('row_outside_month', `The file has rows dated outside ${period}.`);
  }
  const skipped = [
    ...fileSkipped,
    ...bad.map((i) => ({ where: i.ref ?? (i.lineNo ? `line ${i.lineNo}` : 'file'), reason: i.issue })),
  ];
  return { result, period, skipped };
}

export function createParserHandler({ store, now = () => Date.now(), importers = IMPORTERS } = {}) {
  let repo = store;
  const files = () => (repo ??= createRepo());

  // The parsed rows of an import's stored file, for reconcile.
  const loadFrom = (cache) => async (record) => {
    if (cache?.import_id === record.import_id) return cache.result;
    const buf = await files().getObject(record.s3_key);
    if (!buf) throw new Error('the active import has no stored file');
    return readFile(importers, record.source, buf, record.file_name).result;
  };

  async function fail(record, code, message) {
    try {
      await files().put({ ...record, status: 'failed', finished_at: new Date(now()).toISOString(), error: { code, message } }, { if: [{ attr: 'status', op: '=', value: record.status }] });
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
    }
    return 'failed';
  }

  async function importFile(event) {
    const key = event?.detail?.object?.key;
    const match = typeof key === 'string' ? KEY.exec(key) : null;
    if (!match) return 'ignored';
    const [, sub, importId] = match;
    const store = files();
    const record = await getImport(store, sub, importId);
    if (!record) {
      // No record means no upload form was issued for this key: drop the object, write nothing.
      await store.deleteObject(key);
      return 'missing';
    }
    if (record.s3_key !== uploadKey(sub, importId)) return 'ignored';
    if (FINAL.has(record.status) || record.kind !== 'file') return 'ignored';
    const buf = await store.getObject(key);
    if (!buf) return 'ignored';

    let parsed;
    try {
      parsed = readFile(importers, record.source, buf, record.file_name);
    } catch (err) {
      if (err instanceof Refused) return fail(record, err.code, err.message);
      throw err;
    }
    const at = now();
    const eventTime = Date.parse(event.time ?? '') || at;
    const lock = await takeLock(store, sub, importId, { period: parsed.period, now: at, eventTime });
    if (lock.outcome !== 'locked') return lock.outcome;

    const withReport = {
      ...lock.record,
      skipped: parsed.skipped,
      counts: { added: 0, updated: 0, removed: 0, skipped: parsed.skipped.length },
      ...(parsed.result.check ? { checks: parsed.result.check } : {}),
    };
    await store.put(withReport, { if: [{ attr: 'status', op: '=', value: 'importing' }] });
    const commit = await commitImport(store, sub, importId, { content_hash: contentHash(record.source, buf), now: at });
    if (commit.outcome !== 'committed' && commit.outcome !== 'unchanged') return commit.outcome;
    const done = await reconcile(store, sub, importId, { now: at, load: loadFrom({ import_id: importId, result: parsed.result }) });
    return done.outcome;
  }

  async function reconcileOnly({ sub, import_id }) {
    if (typeof sub !== 'string' || typeof import_id !== 'string') return 'ignored';
    impKey(sub, import_id); // refuses malformed parts
    const out = await reconcile(files(), sub, import_id, { now: now(), load: loadFrom() });
    return out.outcome;
  }

  return async (event) => {
    const reconcileMode = event && !event['detail-type'] && 'import_id' in event;
    const outcome = reconcileMode ? await reconcileOnly(event) : await importFile(event);
    const id = reconcileMode ? event.import_id : KEY.exec(event?.detail?.object?.key ?? '')?.[2];
    console.log(JSON.stringify({ msg: 'parser', mode: reconcileMode ? 'reconcile' : 'import', import_id: id, outcome }));
    return { outcome };
  };
}

export const handler = createParserHandler();
