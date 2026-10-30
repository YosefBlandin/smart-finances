import { NextResponse, type NextRequest } from 'next/server';

// Middleware does only the nonce, the content policy and a cookie-presence redirect (D-108). It never reads
// the session: the server-only guard in the money layout and the route handlers does that.

const SESSION_COOKIE = '__Host-sid';
const MONEY_ROUTES = ['/overview', '/transactions', '/review', '/imports', '/rates', '/data'];
const AUTH_ROUTES = ['/sign-up', '/sign-in', '/reset', '/lost-authenticator'];
// Signed-in pages, and the signed-in JSON the browser reads, are never cached.
const SIGNED_IN_ROUTES = [...MONEY_ROUTES, '/consent', '/too-many', '/api/data'];

// Until PR 3 settings are read from process.env, with a test default when STAGE=test (D-110).
const TEST_UPLOAD_HOST = 'uploads.test.invalid';

const under = (path: string, routes: string[]) => routes.some((r) => path === r || path.startsWith(`${r}/`));

// Next.js routes /%6Fverview to /overview, so match on the decoded path; a malformed one is left as it is.
function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function uploadHost(): string | undefined {
  const host = process.env.UPLOAD_HOST;
  if (host) return host;
  return process.env.STAGE === 'test' ? TEST_UPLOAD_HOST : undefined;
}

// Contracts "Response headers". With no upload host outside test, uploads are refused rather than opened up.
function contentPolicy(nonce: string): string {
  const upload = uploadHost();
  const connect = [
    "'self'",
    upload && `https://${upload}`,
    'https://dataplane.rum.us-east-1.amazonaws.com',
    'https://cognito-identity.us-east-1.amazonaws.com',
  ];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.filter(Boolean).join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function withHeaders(res: NextResponse, policy: string, path: string): NextResponse {
  res.headers.set('Content-Security-Policy', policy);
  res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (under(path, SIGNED_IN_ROUTES)) res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const { search } = req.nextUrl;
  const pathname = decoded(req.nextUrl.pathname);
  const nonce = newNonce();
  const policy = contentPolicy(nonce);
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (!hasSession && under(pathname, MONEY_ROUTES)) {
    const to = new URL('/sign-in', req.url);
    to.searchParams.set('next', `${pathname}${search}`);
    return withHeaders(NextResponse.redirect(to), policy, pathname);
  }
  if (hasSession && under(pathname, AUTH_ROUTES)) {
    return withHeaders(NextResponse.redirect(new URL('/overview', req.url)), policy, pathname);
  }

  // The page reads the nonce from x-nonce; Next.js reads the policy to put the nonce on its own scripts.
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  return withHeaders(NextResponse.next({ request: { headers } }), policy, pathname);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
