import { randomUUID } from 'node:crypto';
import { ErrorBody, ROUTES } from '@smart-finances/contracts/routes';
import type { z } from 'zod';
import { createLimits, type LimitsDeps } from '@/application/limits';
import { tokenClaims } from '@/domain/session-policy';
import type { DataApi, DataApiFailure, DataApiResult } from '@/ports/data-api';
import type { IdentityProvider } from '@/ports/identity-provider';
import type { Logger } from '@/ports/logger';
import type { SessionStore } from '@/ports/session-store';

/** The one call this adapter makes; tests pass a hand-written fake, production the runtime's fetch. */
export type DataApiFetch = (
  url: string,
  init: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    cache: 'no-store';
    redirect: 'error';
  },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

/** Each API read times out at 5 seconds, the reply's body included (D-101). */
export const DATA_API_TIMEOUT_MS = 5_000;
/** A renewed access token is reused by calls that still hold the old one for this long, so they do not refresh again. */
const RENEWED_FOR_MS = 60_000;

export type HttpDataApiDeps = LimitsDeps & {
  sessionStore: SessionStore;
  identityProvider: IdentityProvider;
  logger: Logger;
  fetch?: DataApiFetch;
  timeoutMs?: number;
};

type Route = keyof typeof ROUTES;
type Out<K extends Route> = z.output<(typeof ROUTES)[K]['reply']>;
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Request = { method: Method; path: string; query?: unknown; body?: unknown };

const fail = (kind: DataApiFailure['kind'], code?: string, retryAfter?: number): DataApiFailure => ({
  ok: false,
  kind,
  ...(code === undefined ? {} : { code }),
  ...(retryAfter === undefined ? {} : { retryAfter }),
});

/** The person a token belongs to: its sub claim. The API checks the signature; this only picks the counter. */
export function tokenSub(token: string): string | undefined {
  const sub = tokenClaims(token)?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : undefined;
}

/**
 * Counts one data request against the person's limit (D-120; createLimits().hit('person', sub)). Limited when over it
 * (the caller shows the 429 page, AC-17), failed when the counter cannot be reached (closed, never open). Shared by
 * the memory adapter so STAGE=test reaches the same limit.
 */
export async function countPersonRequest(deps: LimitsDeps & { logger?: Logger }, sub: string): Promise<DataApiFailure | undefined> {
  try {
    const hit = await createLimits(deps).hit('person', sub);
    if (hit.ok) return undefined;
    deps.logger?.event('rate_limited', 'person', { sub, requestId: randomUUID() });
    return fail('limited', undefined, hit.retryAfterSeconds);
  } catch {
    return fail('failed', 'unavailable');
  }
}

/** Whole seconds from a Retry-After header (seconds form only); undefined otherwise. */
function retryAfterOf(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

/** The error code from an { error: { code, message } } body, when the body is one. */
function errorCode(text: string): string | undefined {
  try {
    const parsed = ErrorBody.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.error.code : undefined;
  } catch {
    return undefined;
  }
}

class Timeout extends Error {}

/**
 * The data API over HTTP (architecture.md "Data access (web server)", Contracts "Data API"): one method per route of
 * @smart-finances/contracts, the access token as a bearer token (D-53), a 5-second budget per request (D-101), the
 * input checked and the reply parsed with the shared schemas (D-133), and the status mapped to the port's kinds:
 * 401 refreshes the tokens once and retries, then signs out (the session row goes); 403 and 404 are not_found; 409 is
 * conflict; 429, 5xx, a timeout, a network error or a reply off the contract are failed (the screens offer a retry).
 * Every call counts against the person's limit first (D-120). Expected failures are answers, never throws.
 */
export class HttpDataApi implements DataApi {
  private readonly fetch: DataApiFetch;
  private readonly timeoutMs: number;
  private readonly renewed = new Map<string, { at: number; next: Promise<string | undefined> }>();

  constructor(private readonly deps: HttpDataApiDeps) {
    this.fetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = deps.timeoutMs ?? DATA_API_TIMEOUT_MS;
  }

  listTransactions: DataApi['listTransactions'] = (token, input) =>
    this.call(token, 'GET /transactions', input, (q) => ({ method: 'GET', path: '/transactions', query: q }));

  totals: DataApi['totals'] = (token, input) => this.call(token, 'GET /totals', input, (q) => ({ method: 'GET', path: '/totals', query: q }));

  rates: DataApi['rates'] = (token) => this.call(token, 'GET /rates', undefined, () => ({ method: 'GET', path: '/rates' }));

  putRate: DataApi['putRate'] = (token, { month, ...body }) =>
    this.call(
      token,
      'PUT /rates/{month}',
      body,
      (b) => ({ method: 'PUT', path: `/rates/${encodeURIComponent(month)}`, body: b }),
      () => /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
    );

  review: DataApi['review'] = (token) => this.call(token, 'GET /review', undefined, () => ({ method: 'GET', path: '/review' }));

  putReview: DataApi['putReview'] = (token, { id, ...body }) =>
    this.call(
      token,
      'PUT /transactions/{id}/review',
      body,
      (b) => ({ method: 'PUT', path: `/transactions/${encodeURIComponent(id)}/review`, body: b }),
      () => id.length > 0,
    );

  listImports: DataApi['listImports'] = (token, input) =>
    this.call(token, 'GET /imports', input, (q) => ({ method: 'GET', path: '/imports', query: q }));

  getImport: DataApi['getImport'] = (token, { id }) =>
    this.call(
      token,
      'GET /imports/{id}',
      undefined,
      () => ({ method: 'GET', path: `/imports/${encodeURIComponent(id)}` }),
      () => id.length > 0,
    );

  requestImport: DataApi['requestImport'] = (token, input) =>
    this.call(token, 'POST /imports', input, (b) => ({ method: 'POST', path: '/imports', body: b }));

  exportCsv: DataApi['exportCsv'] = (token) => this.call(token, 'GET /export', undefined, () => ({ method: 'GET', path: '/export' }));

  erase: DataApi['erase'] = (token, input) => this.call(token, 'DELETE /data', input, (b) => ({ method: 'DELETE', path: '/data', body: b }));

  /** Checks, counts, sends (refreshing once on 401) and parses one call of route. */
  private async call<K extends Route>(
    token: string,
    route: K,
    input: unknown,
    build: (parsed: unknown) => Request,
    pathOk: () => boolean = () => true,
  ): Promise<DataApiResult<Out<K>>> {
    const sub = tokenSub(token);
    if (!sub) return fail('unauthorized');
    const limited = await countPersonRequest(this.deps, sub);
    if (limited) return limited;

    const schema = (ROUTES[route] as { request?: z.ZodType }).request;
    let parsed: unknown = undefined;
    if (schema) {
      const checked = schema.safeParse(input);
      if (!checked.success) return fail('failed', 'bad_request');
      parsed = checked.data;
    }
    if (!pathOk()) return fail('failed', 'bad_request');
    const request = build(parsed);

    let answer = await this.send(token, request);
    if (answer.status === 401) {
      const fresh = await this.renew(sub, token);
      if (fresh) answer = await this.send(fresh, request);
      if (!fresh || answer.status === 401) {
        await this.signOut(sub, fresh ?? token);
        return fail('unauthorized');
      }
    }
    return this.read(route, answer);
  }

  /** One request within the time budget: a status and the body text, or a timeout or network failure. */
  private async send(token: string, { method, path, query, body }: Request): Promise<{ status: number; text: string; retryAfter?: number }> {
    const url = new URL(this.deps.settings.get().API_URL.replace(/\/+$/, '') + path);
    for (const [k, v] of Object.entries((query ?? {}) as Record<string, unknown>)) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json, text/csv' };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Timeout());
      }, this.timeoutMs);
    });
    const request = (async () => {
      const res = await this.fetch(url.toString(), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        // Never Next.js's data cache (one person's reply must not serve another), and never a redirect elsewhere.
        cache: 'no-store',
        redirect: 'error',
      });
      const retryAfter = retryAfterOf(res.headers.get('retry-after'));
      return { status: res.status, text: await res.text(), ...(retryAfter === undefined ? {} : { retryAfter }) };
    })();
    // The losing promise's rejection is handled, so an abort after the timeout raises nothing unhandled.
    request.catch(() => {});
    try {
      return await Promise.race([request, timeout]);
    } catch (err) {
      return { status: err instanceof Timeout ? -1 : 0, text: '' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** The port's answer for a status and body. */
  private read<K extends Route>(
    route: K,
    { status, text, retryAfter }: { status: number; text: string; retryAfter?: number },
  ): DataApiResult<Out<K>> {
    if (status === -1) return fail('failed', 'timeout');
    if (status === 0) return fail('failed', 'network');
    if (status >= 200 && status < 300) {
      const reply = ROUTES[route].reply as unknown as z.ZodType<Out<K>>;
      let value: unknown = text;
      if (route !== 'GET /export') {
        try {
          value = JSON.parse(text);
        } catch {
          return fail('failed', 'bad_reply');
        }
      }
      const parsed = reply.safeParse(value);
      return parsed.success ? { ok: true, data: parsed.data } : fail('failed', 'bad_reply');
    }
    const code = errorCode(text);
    if (status === 403 || status === 404) return fail('not_found', code ?? 'not_found');
    if (status === 409) return fail('conflict', code ?? 'conflict');
    if (status === 429) return fail('failed', 'throttled', retryAfter);
    if (status >= 500) return fail('failed', 'server', retryAfter);
    return fail('failed', code ?? 'bad_request');
  }

  /**
   * One refresh for a token the API refused: the session row that holds it gets new tokens (the refresh token stays in
   * the row; the sub is the username, as in application/session.ts). Calls that hold the same old token share the
   * one refresh for a minute. Undefined when there is no such row or the refresh is refused or fails.
   */
  private renew(sub: string, token: string): Promise<string | undefined> {
    const now = this.deps.clock.now();
    for (const [k, v] of this.renewed) if (now - v.at > RENEWED_FOR_MS) this.renewed.delete(k);
    const known = this.renewed.get(token);
    if (known) return known.next;
    const next = (async () => {
      const row = (await this.deps.sessionStore.listBySub(sub)).find((r) => r.accessToken === token);
      if (!row) return undefined;
      const result = await this.deps.identityProvider.refresh(row.sub, row.refreshToken);
      if (!result.ok) return undefined;
      // Written back only while the row still exists, so a sign-out during the refresh stays a sign-out.
      if (!(await this.deps.sessionStore.get(row.idHash))) return undefined;
      await this.deps.sessionStore.create({
        ...row,
        accessToken: result.tokens.access,
        idToken: result.tokens.id,
        refreshToken: result.tokens.refresh,
      });
      return result.tokens.access;
    })().catch(() => undefined);
    this.renewed.set(token, { at: now, next });
    return next;
  }

  /** Signed out: the session row holding the refused token goes and its refresh token is revoked. */
  private async signOut(sub: string, token: string): Promise<void> {
    try {
      const rows = (await this.deps.sessionStore.listBySub(sub)).filter((r) => r.accessToken === token);
      for (const row of rows) {
        await this.deps.sessionStore.delete(row.idHash);
        await this.deps.identityProvider.revoke(row.refreshToken);
      }
    } catch {
      // The answer is unauthorized either way; the session's own expiry still ends it.
    }
    this.deps.logger.event('signout', 'data_api_unauthorized', { sub, requestId: randomUUID() });
  }
}
