import { redirect } from 'next/navigation';
import { getContainer } from '@/adapters/container';
import { createDataReads, type DataReads } from '@/application/data/reads';
import type { Session } from '@/application/session';
import type { DataApiFailure, DataApiResult } from '@/ports/data-api';
import { requireMoneyAccess } from '../../guarded';

// Shared by the JSON read routes /api/data/* (D-127; architecture.md "Data access (web server)"). Each route checks the
// session, the current consent and an active account (requireMoneyAccess, D-168), runs one read use case for that
// session, and answers its data as JSON, or { error: { code } } with a status the browser hooks act on: 401 signed out,
// 403 no consent or account being deleted, 404 not found, 409 conflict, 429 past the person limit with Retry-After
// (AC-17), 400 an input the contracts refuse, 502 a data API failure (retry), 503 an unexpected one. Never cached.

export const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function errorResponse(status: number, code: string, retryAfter?: number): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (retryAfter !== undefined) headers['Retry-After'] = String(retryAfter);
  return Response.json({ error: { code } }, { status, headers });
}

function failure(f: DataApiFailure): Response {
  switch (f.kind) {
    case 'unauthorized':
      return errorResponse(401, 'unauthorized');
    case 'not_found':
      return errorResponse(404, 'not_found');
    case 'conflict':
      return errorResponse(409, f.code ?? 'conflict');
    case 'limited':
      return errorResponse(429, 'limited', f.retryAfter ?? 60);
    default:
      return f.code === 'bad_request' ? errorResponse(400, 'bad_request') : errorResponse(502, f.code ?? 'failed', f.retryAfter);
  }
}

/**
 * The route's answer: the session check, then read(reads, session). ok answers through ok (JSON by default); a failure
 * answers its status. Nothing about the person comes from the request: only the session's token is used.
 */
export async function dataRoute<T>(
  read: (reads: DataReads, session: Session) => Promise<DataApiResult<T>>,
  ok: (data: T) => Response = (data) => Response.json(data, { headers: NO_STORE }),
): Promise<Response> {
  try {
    const access = await requireMoneyAccess();
    if (!access.ok) {
      if (access.reason === 'signed-out') return errorResponse(401, 'unauthorized');
      return errorResponse(403, access.reason === 'consent' ? 'consent' : 'forbidden');
    }
    const result = await read(createDataReads(getContainer()), access.session);
    return result.ok ? ok(result.data) : failure(result);
  } catch {
    return errorResponse(503, 'unavailable');
  }
}

/** The named search values of a request, as strings; anything else in the address is ignored. */
export function searchValues<K extends string>(request: Request, names: readonly K[]): Partial<Record<K, string>> {
  const params = new URL(request.url).searchParams;
  const out: Partial<Record<K, string>> = {};
  for (const name of names) {
    const v = params.get(name);
    if (v !== null && v !== '') out[name] = v;
  }
  return out;
}

/**
 * For server renders that read through the use cases (the money pages' prefetch): a read past the person limit goes to
 * the limit page with the wait (AC-17); every other answer passes through for the page to show.
 */
export function redirectIfLimited<T>(result: DataApiResult<T>): DataApiResult<T> {
  if (!result.ok && result.kind === 'limited') redirect(`/too-many?wait=${result.retryAfter ?? 60}`);
  return result;
}
