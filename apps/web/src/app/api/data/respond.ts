import { ERROR_CODES } from '@smart-finances/contracts/routes';
import { redirect } from 'next/navigation';
import { getContainer } from '@/adapters/container';
import { createDataReads, type DataReads } from '@/application/data/reads';
import { createSessions, type Session } from '@/application/session';
import type { DataApiFailure, DataApiResult } from '@/ports/data-api';
import { signedOutPath } from '@/queries/keys';
import { readSessionCookie } from '../../cookies';
import { requireMoneyAccess } from '../../guarded';

// Shared by the JSON read routes /api/data/* (D-127; architecture.md "Data access (web server)"). Each route checks the
// session, the current consent and an active account (requireMoneyAccess, D-168), runs one read use case for that
// session, and answers its data as JSON, or { error: { code } } with a status the browser hooks act on: 401 signed out,
// 403 no consent or account being deleted, 404 not found, 409 conflict (a code the contracts list for 409, else conflict), 429 past the person limit with Retry-After
// (AC-17), 400 an input the contracts refuse, 502 a data API failure (retry), 503 an unexpected one. Never cached.
// A token the data API refuses (401 after its one refresh, architecture "Data access") ends this session here too, so
// the person is signed out whichever adapter answered; the browser then goes to sign-in with its address kept.

export const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function errorResponse(status: number, code: string, retryAfter?: number): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (retryAfter !== undefined) headers['Retry-After'] = String(retryAfter);
  return Response.json({ error: { code } }, { status, headers });
}

/** The 409 codes the contracts list (conflict, source_file_only); the API's code is answered only when it is one. */
const CONFLICT_CODES: readonly string[] = Object.entries(ERROR_CODES)
  .filter(([, status]) => status === 409)
  .map(([code]) => code);

function failure(f: DataApiFailure): Response {
  switch (f.kind) {
    case 'unauthorized':
      return errorResponse(401, 'unauthorized');
    case 'not_found':
      return errorResponse(404, 'not_found');
    case 'conflict':
      return errorResponse(409, f.code !== undefined && CONFLICT_CODES.includes(f.code) ? f.code : 'conflict');
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
    if (!result.ok && result.kind === 'unauthorized') await endThisSession();
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

/** Signs out the session of this request (its row goes, its refresh token is revoked); nothing without one. */
async function endThisSession(): Promise<void> {
  await createSessions(getContainer()).endSession(await readSessionCookie());
}

/**
 * For server renders that read through the use cases (the money pages' prefetch): a read past the person limit goes to
 * the limit page with the wait (AC-17); every other answer passes through for the page to show.
 */
export function redirectIfLimited<T>(result: DataApiResult<T>): DataApiResult<T> {
  if (!result.ok && result.kind === 'limited') redirect(`/too-many?wait=${result.retryAfter ?? 60}`);
  return result;
}

/**
 * For server renders that read through the use cases (the money pages' prefetch): a read past the person limit goes to
 * the limit page with the wait (AC-17); a token the data API refuses ends the session and goes to sign-in with the
 * page's address kept (architecture "Screen states": to sign-in, path kept), through GET /api/data/signed-out, which
 * clears the cookie (the middleware sends /sign-in back to the overview while it is set). Every other answer passes
 * through for the page to show. address is the page's own path and search, as the person asked for it.
 */
export async function redirectIfStopped<T>(result: DataApiResult<T>, address: string): Promise<DataApiResult<T>> {
  if (!result.ok && result.kind === 'unauthorized') {
    await endThisSession();
    redirect(signedOutPath(address));
  }
  return redirectIfLimited(result);
}
