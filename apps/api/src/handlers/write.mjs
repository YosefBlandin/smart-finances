// api-write: the routes that change data (architecture.md Components "Handlers"). A thin
// adapter: the person comes only from the verified claims, input is checked with the shared
// contract schemas (D-39), and the core modules do the work.
import { ROUTES, checkImportRequest, SOURCES } from '@smart-finances/contracts/routes';
import { createImport, FORM_SECONDS } from '../store/imports.mjs';
import { createRepo } from '../store/repo.mjs';
import { ulid as defaultUlid } from '../store/ulid.mjs';
import { HttpError, fail, personOf, reply } from './http.mjs';

export function jsonBody(event) {
  if (event.body === undefined || event.body === null || event.body === '') return undefined;
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError('bad_request', 'the body is not JSON');
  }
}

export function checked(route, value) {
  const parsed = ROUTES[route].request.safeParse(value);
  if (!parsed.success) throw new HttpError('bad_request', parsed.error.issues[0]?.message ?? 'invalid request');
  return parsed.data;
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

const ROUTE_HANDLERS = {
  'POST /imports': requestImport,
};

export function createWriteHandler({ store, now = () => Date.now(), ulid = defaultUlid, parserFunction = process.env.PARSER_FUNCTION } = {}) {
  const deps = { now, ulid, parserFunction };
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
