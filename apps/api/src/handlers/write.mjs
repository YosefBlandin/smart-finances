// api-write: the routes that change data (architecture.md Components "Handlers"). A thin
// adapter: the person comes only from the verified claims, input is checked with the shared
// contract schemas (D-39), and the core modules do the work.
import { checkImportRequest, SOURCES } from '@smart-finances/contracts/routes';
import { abandonReconcile, createImport, FORM_SECONDS, inEraseWindow, startRepair, startUndo } from '../store/imports.mjs';
import { erasedKey } from '../store/keys.mjs';
import { createRepo } from '../store/repo.mjs';
import { monthsWithData } from '../store/totals.mjs';
import { ulid as defaultUlid } from '../store/ulid.mjs';
import { HttpError, checked, fail, personOf, reply } from './http.mjs';

export { checked };

export function jsonBody(event) {
  if (event.body === undefined || event.body === null || event.body === '') return undefined;
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError('bad_request', 'the body is not JSON');
  }
}


// POST /imports (D-15): an import record and a presigned form for exactly its object key.
async function requestImport(deps, sub, event) {
  const body = jsonBody(event);
  const verdict = checkImportRequest(body ?? {});
  if (!verdict.ok) throw new HttpError(verdict.code, verdict.message);
  const { source, file_name, size } = checked('POST /imports', body);
  const record = await createImport(deps.store, sub, { source, file_name, size, now: deps.now(), ulid: deps.ulid });
  const upload = await deps.store.presignPost(record.s3_key, { maxBytes: SOURCES[source].maxBytes, expiresSeconds: FORM_SECONDS });
  return reply(201, { import_id: record.import_id, upload: { url: upload.url, fields: upload.fields }, expires_at: record.expires_at });
}

const PERIOD = /^(\d{4}-(0[1-9]|1[0-2])|log)$/;
const ID = /^[0-9A-Za-z]{1,64}$/;

// Undo and repair answer 202 once the record holds the lock; the parser reconciles async.
async function started(deps, sub, out) {
  if (out.outcome === 'not_found') throw new HttpError('not_found', 'no such import or period');
  if (out.outcome === 'conflict') throw new HttpError('conflict', out.reason);
  try {
    await deps.store.invokeAsync(deps.parserFunction, { sub, import_id: out.record.import_id });
  } catch (err) {
    // Fail the record and free the period, then answer 500: the owner can repair the period.
    await abandonReconcile(deps.store, sub, out.record.import_id, { now: deps.now() });
    throw err;
  }
  return reply(202, { import_id: out.record.import_id });
}

// POST /imports/{id}/undo (D-17): only a period's active import.
async function undoImport(deps, sub, event) {
  const id = event.pathParameters?.id;
  if (typeof id !== 'string' || !ID.test(id)) throw new HttpError('not_found', 'no such import');
  return started(deps, sub, await startUndo(deps.store, sub, id, { now: deps.now(), ulid: deps.ulid }));
}

// POST /periods/{source}/{period}/repair: the owner's fix for a stalled import, undo or repair.
async function repairPeriod(deps, sub, event) {
  const { source, period } = event.pathParameters ?? {};
  if (!Object.hasOwn(SOURCES, source ?? '') || !PERIOD.test(period ?? '')) throw new HttpError('bad_request', 'unknown source or period');
  const monthly = source === 'mercadopago' || source === 'excel';
  if (monthly === (period === 'log')) throw new HttpError('bad_request', 'this source does not use that period');
  return started(deps, sub, await startRepair(deps.store, sub, source, period, { now: deps.now(), ulid: deps.ulid }));
}

// Refused from erased_at until quiet_until (D-30).
async function refuseWhileErasing(deps, sub) {
  const marker = await deps.store.get(erasedKey(sub), { consistent: true });
  if (inEraseWindow(marker, deps.now())) throw new HttpError('conflict', 'your data is being deleted; try again later');
}

// POST /totals/rebuild: the owner's fix for a batch that reached the rollup's on-failure queue.
async function rebuildTotals(deps, sub) {
  await refuseWhileErasing(deps, sub);
  const months = await monthsWithData(deps.store, sub);
  await deps.store.invokeAsync(deps.rollupFunction, { sub, months: 'all' });
  return reply(202, { months: months.length });
}

const ROUTE_HANDLERS = {
  'POST /imports': requestImport,
  'POST /imports/{id}/undo': undoImport,
  'POST /periods/{source}/{period}/repair': repairPeriod,
  'POST /totals/rebuild': rebuildTotals,
};

export function createWriteHandler({
  store,
  now = () => Date.now(),
  ulid = defaultUlid,
  parserFunction = process.env.PARSER_FUNCTION,
  rollupFunction = process.env.ROLLUP_FUNCTION,
} = {}) {
  const deps = { now, ulid, parserFunction, rollupFunction };
  return async (event) => {
    try {
      const sub = personOf(event);
      const route = ROUTE_HANDLERS[event.routeKey];
      if (!route) throw new HttpError('not_found', 'no such route');
      deps.store ??= store ?? createRepo();
      return await route(deps, sub, event);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(JSON.stringify({ msg: 'write failed', route: event?.routeKey, error: err?.name }));
      return fail(err);
    }
  };
}

export const handler = createWriteHandler();
