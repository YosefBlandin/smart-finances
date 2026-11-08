// api-read: the GET routes (architecture.md Components "Handlers"). A thin adapter: the person
// comes only from the verified claims, and every reply has the shape of the shared contract
// (D-39): optional fields are left out, never null.
import { createHash } from 'node:crypto';
import { getImport, inEraseWindow, lockLive } from '../store/imports.mjs';
import { erasedKey, personPk, PREFIX } from '../store/keys.mjs';
import { listRates, readTotals } from '../store/rates.mjs';
import { toCsv } from '../ingest/schema.mjs';
import { allRows, selectRows, shownRow, shownRows } from '../store/query.mjs';
import { reviewList } from '../store/review.mjs';
import { createRepo } from '../store/repo.mjs';
import { HttpError, checked, fail, personOf, reply } from './http.mjs';

export const IMPORTS_PAGE = 50;
const ID = /^[0-9A-Za-z]{1,64}$/;

// Cursor: base64url of { offset, hash }, where hash is a sha-256 of the query without its
// cursor, so a cursor from another query is refused.
const queryHash = (route, query) => createHash('sha256').update(JSON.stringify([route, query])).digest('hex');
export const encodeCursor = (offset, route, query) => Buffer.from(JSON.stringify({ offset, hash: queryHash(route, query) })).toString('base64url');
export function decodeCursor(cursor, route, query) {
  if (cursor === undefined) return 0;
  try {
    const { offset, hash } = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (Number.isInteger(offset) && offset >= 0 && hash === queryHash(route, query)) return offset;
  } catch {
    // falls through
  }
  throw new HttpError('bad_request', 'the cursor does not belong to this query');
}

// What a reader sees: requested past expires_at is expired (the file never arrived); importing
// or reconciling while the period's lock is no longer this record's and live is stalled.
function shownStatus(record, pointer, now) {
  if (record.status === 'requested' && record.expires_at <= new Date(now).toISOString()) return 'expired';
  if ((record.status === 'importing' || record.status === 'reconciling') && !(pointer?.lock_import === record.import_id && lockLive(pointer, now))) return 'stalled';
  return record.status;
}

const EXPIRED_ERROR = { code: 'file_not_arrived', message: 'The file never arrived, for example because it was over the size limit.' };

function importItem(record, pointer, now) {
  return {
    import_id: record.import_id,
    source: record.source,
    file_name: record.file_name ?? '',
    period: record.period ?? '',
    status: shownStatus(record, pointer, now),
    created_at: record.created_at,
    ...(record.finished_at ? { finished_at: record.finished_at } : {}),
    ...(record.counts ? { counts: record.counts } : {}),
    active: Boolean(record.period) && pointer?.active_import === record.import_id,
  };
}

// The whole record, as the contract shows it: error as its message text (D-39).
function importRecord(record, pointer, now) {
  const item = importItem(record, pointer, now);
  const error = item.status === 'expired' ? EXPIRED_ERROR : record.error;
  const { pk: _pk, sk: _sk, planned_counts: _planned, error: _error, ...rest } = record;
  return { ...rest, ...item, ...(error ? { error: error.message } : {}) };
}

async function pointers(store, sub) {
  const { items } = await store.query({ pk: personPk(sub), prefix: PREFIX.PER, consistent: true });
  return new Map(items.map((p) => [p.sk, p]));
}
const pointerFor = (map, record) => (record.period ? map.get(`${PREFIX.PER}${record.source}#${record.period}`) : undefined);

// GET /imports: newest first, 50 a page.
async function listImports(deps, sub, event) {
  const { cursor } = checked('GET /imports', event.queryStringParameters ?? {});
  const offset = decodeCursor(cursor, 'GET /imports', {});
  const [{ items }, map] = await Promise.all([
    deps.store.query({ pk: personPk(sub), prefix: PREFIX.IMP, consistent: true }),
    pointers(deps.store, sub),
  ]);
  const now = deps.now();
  const newest = items.sort((a, b) => (a.sk < b.sk ? 1 : a.sk > b.sk ? -1 : 0));
  const page = newest.slice(offset, offset + IMPORTS_PAGE).map((r) => importItem(r, pointerFor(map, r), now));
  const next = offset + IMPORTS_PAGE < newest.length ? encodeCursor(offset + IMPORTS_PAGE, 'GET /imports', {}) : undefined;
  return reply(200, { items: page, ...(next ? { cursor: next } : {}) });
}

// GET /imports/{id}
async function readImport(deps, sub, event) {
  const id = event.pathParameters?.id;
  if (typeof id !== 'string' || !ID.test(id)) throw new HttpError('not_found', 'no such import');
  const record = await getImport(deps.store, sub, id);
  if (!record) throw new HttpError('not_found', 'no such import');
  const map = await pointers(deps.store, sub);
  return reply(200, importRecord(record, pointerFor(map, record), deps.now()));
}

// One page of a filtered, sorted list, with a cursor bound to the query that made it.
function paged(items, route, query, limit) {
  const { cursor, ...rest } = query;
  const offset = decodeCursor(cursor, route, rest);
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? encodeCursor(offset + limit, route, rest) : undefined;
  return { items: page, ...(next ? { cursor: next } : {}) };
}

// GET /transactions (D-26): the asked months' rows, review choices applied, then filtered.
async function listTransactions(deps, sub, event) {
  const query = checked('GET /transactions', event.queryStringParameters ?? {});
  const rows = selectRows(await shownRows(deps.store, sub, query.from, query.to), query);
  return reply(200, paged(rows, 'GET /transactions', query, query.limit));
}

// GET /totals: stored month totals; refused from erased_at until quiet_until (D-30).
async function totals(deps, sub, event) {
  const query = checked('GET /totals', event.queryStringParameters ?? {});
  const marker = await deps.store.get(erasedKey(sub), { consistent: true });
  if (inEraseWindow(marker, deps.now())) throw new HttpError('conflict', 'your data is being deleted; try again later');
  return reply(200, await readTotals(deps.store, sub, query));
}

// GET /rates
async function rates(deps, sub) {
  return reply(200, { items: await listRates(deps.store, sub) });
}

// GET /review
async function review(deps, sub) {
  return reply(200, { items: await reviewList(deps.store, sub) });
}

// toCsv already guards the free-text columns; the export guards every column but amount (Values).
const FORMULA_START = /^[=+\-@\t\r]/;
const guarded = (value) => (typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : value);
const EXPORT_GUARDED = ['id', 'date', 'date_precision', 'kind', 'currency', 'source', 'country', 'import_batch'];

// GET /export (AC-17): every row, review choices applied, in the schema's columns.
async function exportCsv(deps, sub) {
  const rows = (await allRows(deps.store, sub)).map(({ row, choice }) => {
    const { review, ...shown } = shownRow(row, choice);
    for (const field of EXPORT_GUARDED) shown[field] = guarded(shown[field]);
    return shown;
  });
  return { statusCode: 200, headers: { 'content-type': 'text/csv; charset=utf-8' }, body: toCsv(rows) };
}

const ROUTE_HANDLERS = {
  'GET /imports': listImports,
  'GET /imports/{id}': readImport,
  'GET /transactions': listTransactions,
  'GET /totals': totals,
  'GET /rates': rates,
  'GET /review': review,
  'GET /export': exportCsv,
};

export function createReadHandler({ store, now = () => Date.now(), routes = {} } = {}) {
  const deps = { now };
  const table = { ...ROUTE_HANDLERS, ...routes };
  return async (event) => {
    try {
      const sub = personOf(event);
      const route = table[event.routeKey];
      if (!route) throw new HttpError('not_found', 'no such route');
      deps.store ??= store ?? createRepo();
      return await route(deps, sub, event);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(JSON.stringify({ msg: 'read failed', route: event?.routeKey, error: err?.name }));
      return fail(err);
    }
  };
}

export const handler = createReadHandler();
