// api-delete: DELETE /data, and a direct invoke of { sub } from the web stack's housekeeping for
// an account deletion (D-30, D-40). Both run the same erase. The direct invoke throws when the
// erase cannot start, so the caller sees a function error and tries again next hour.
import { eraseAll } from '../store/erase.mjs';
import { createRepo } from '../store/repo.mjs';
import { checked, fail, HttpError, personOf, reply } from './http.mjs';

function body(event) {
  try {
    return JSON.parse(event.body ?? '');
  } catch {
    throw new HttpError('bad_request', 'the body is not JSON');
  }
}

export function createDeleteHandler({ store, now = () => Date.now() } = {}) {
  return async (event) => {
    store ??= createRepo();
    // Direct invoke: no HTTP request context, only the person.
    if (event && !event.requestContext && !event.routeKey) {
      if (typeof event.sub !== 'string' || !event.sub.trim() || Object.keys(event).length !== 1) throw new Error('unexpected delete input');
      const out = await eraseAll(store, event.sub, { now });
      if (out.conflict) throw new Error('erase refused: work is still running');
      console.log(JSON.stringify({ msg: 'erase', mode: 'direct', items: out.deleted.items, files: out.deleted.files }));
      return out;
    }
    try {
      const sub = personOf(event);
      if (event.routeKey !== 'DELETE /data') throw new HttpError('not_found', 'no such route');
      checked('DELETE /data', body(event));
      const out = await eraseAll(store, sub, { now });
      if (out.conflict) throw new HttpError('conflict', `${out.conflict}; try again in a few minutes`);
      console.log(JSON.stringify({ msg: 'erase', mode: 'http', items: out.deleted.items, files: out.deleted.files }));
      return reply(202, out);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(JSON.stringify({ msg: 'delete failed', error: err?.name }));
      return fail(err);
    }
  };
}

export const handler = createDeleteHandler();
