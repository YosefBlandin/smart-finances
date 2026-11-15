// What every HTTP handler shares: who is asking, and how answers and errors look on the wire.

import { ROUTES } from '@smart-finances/contracts/routes';

export const STATUS = {
  unauthorized: 401,
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  source_file_only: 409,
  too_large: 413,
};

export class HttpError extends Error {
  // retryAfter: whole seconds until the request can succeed, sent as Retry-After when known.
  constructor(code, message = code, { retryAfter } = {}) {
    if (!Object.hasOwn(STATUS, code)) throw new Error(`unknown error code: ${code}`);
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = STATUS[code];
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

// The person is the sub the JWT authorizer verified. Never read from the path, query or body,
// so no request can name another person's partition.
export function personOf(event) {
  const sub = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== 'string' || !sub.trim()) throw new HttpError('unauthorized', 'sign-in required');
  return sub;
}

export const reply = (status, body, headers = {}) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

// Unexpected errors become a bare 500: their messages can hold keys or stored text.
export function fail(err) {
  if (err instanceof HttpError) {
    const headers = err.retryAfter === undefined ? {} : { 'retry-after': String(err.retryAfter) };
    return reply(err.status, { error: { code: err.code, message: err.message } }, headers);
  }
  return reply(500, { error: { code: 'internal', message: 'internal error' } });
}

// Checks a request against the shared contract's schema for its route (D-39).
export function checked(route, value) {
  const parsed = ROUTES[route].request.safeParse(value);
  if (!parsed.success) throw new HttpError('bad_request', parsed.error.issues[0]?.message ?? 'invalid request');
  return parsed.data;
}
