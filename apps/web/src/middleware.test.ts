import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, middleware } from './middleware';

const ORIGIN = 'http://localhost:3000';
const MONEY = ['/overview', '/transactions', '/review', '/imports', '/rates', '/data'];
const AUTH = ['/sign-up', '/sign-up/confirm', '/sign-in', '/sign-in/code', '/sign-in/setup', '/reset', '/reset/confirm', '/lost-authenticator'];

function run(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return middleware(new NextRequest(`${ORIGIN}${path}`, { headers }));
}

function nonceOf(res: Response) {
  const csp = res.headers.get('content-security-policy') ?? '';
  const m = /'nonce-([^']+)'/.exec(csp);
  if (!m?.[1]) throw new Error(`no nonce in: ${csp}`);
  return m[1];
}

const policy = (n: string, upload: string) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${n}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${n}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' https://${upload} https://dataplane.rum.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

afterEach(() => vi.unstubAllEnvs());

describe('T-WEB-7: headers on every response', () => {
  it('T-WEB-7: sets the content policy from the contract with the nonce and the upload host', () => {
    vi.stubEnv('UPLOAD_HOST', 'uploads.example.test');
    const res = run('/overview', '__Host-sid=x');
    expect(res.headers.get('content-security-policy')).toBe(policy(nonceOf(res), 'uploads.example.test'));
  });

  it('T-WEB-7: falls back to the test upload host when STAGE=test and UPLOAD_HOST is unset', () => {
    vi.stubEnv('STAGE', 'test');
    vi.stubEnv('UPLOAD_HOST', '');
    const res = run('/sign-in');
    expect(res.headers.get('content-security-policy')).toBe(policy(nonceOf(res), 'uploads.test.invalid'));
  });

  it('T-WEB-7: outside test with no UPLOAD_HOST, connect-src names no upload host (uploads fail closed)', () => {
    vi.stubEnv('STAGE', 'qa');
    vi.stubEnv('UPLOAD_HOST', '');
    const csp = run('/sign-in').headers.get('content-security-policy') ?? '';
    expect(csp).toContain("connect-src 'self' https://dataplane.rum.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com;");
    expect(csp).not.toContain('https:// ');
  });

  it('T-WEB-7: sets the fixed security headers', () => {
    for (const res of [run('/sign-in'), run('/overview', '__Host-sid=x'), run('/overview'), run('/api/health')]) {
      expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
      expect(res.headers.get('content-security-policy')).toMatch(/'nonce-[^']+'/);
    }
  });

  it('T-WEB-7: a fresh nonce on every request, at least 128 bits, base64', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(nonceOf(run('/sign-in')));
    expect(seen.size).toBe(50);
    for (const n of seen) {
      expect(n).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(Buffer.from(n, 'base64').length).toBeGreaterThanOrEqual(16);
    }
  });

  it('T-WEB-7: passes the nonce and the policy on to the page in the request headers', () => {
    const res = run('/overview', '__Host-sid=x');
    const n = nonceOf(res);
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(n);
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(res.headers.get('content-security-policy'));
    expect(res.headers.get('x-middleware-override-headers')?.split(',')).toEqual(expect.arrayContaining(['x-nonce', 'content-security-policy']));
  });

  it('T-WEB-7: a nonce sent by the browser is replaced, never echoed', () => {
    const req = new NextRequest(`${ORIGIN}/sign-in`, { headers: { 'x-nonce': 'attacker' } });
    const res = middleware(req);
    expect(nonceOf(res)).not.toBe('attacker');
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(res));
  });

  it('T-WEB-7: no-store on signed-in pages only', () => {
    for (const p of [...MONEY, '/consent', '/too-many', '/api/data/totals', '/api/data/export'])
      expect(run(p, '__Host-sid=x').headers.get('cache-control'), p).toBe('no-store');
    for (const p of ['/sign-in', '/privacy', '/terms']) expect(run(p).headers.get('cache-control'), p).toBeNull();
  });

  it('T-WEB-7: the matcher skips only built assets', () => {
    const [source] = config.matcher;
    const re = new RegExp(`^${source}$`);
    for (const p of ['/', '/overview', '/sign-in', '/api/health', '/api/data/totals']) expect(re.test(p), p).toBe(true);
    for (const p of ['/_next/static/chunks/main.js', '/_next/image', '/favicon.ico']) expect(re.test(p), p).toBe(false);
  });
});

describe('T-WEB-7: redirects by cookie presence only', () => {
  it('T-WEB-7: a money route without __Host-sid goes to /sign-in?next=<path>', () => {
    for (const p of MONEY) {
      const res = run(p);
      expect(res.status, p).toBe(307);
      const to = new URL(res.headers.get('location') ?? '');
      expect(to.origin).toBe(ORIGIN);
      expect(to.pathname).toBe('/sign-in');
      expect(to.searchParams.get('next')).toBe(p);
    }
  });

  it('T-WEB-7: next keeps nested paths and the search values', () => {
    const to = new URL(run('/transactions?month=2026-05&sort=amount').headers.get('location') ?? '');
    expect(to.searchParams.get('next')).toBe('/transactions?month=2026-05&sort=amount');
    expect(new URL(run('/imports/abc').headers.get('location') ?? '').searchParams.get('next')).toBe('/imports/abc');
  });

  it('T-WEB-7: any __Host-sid value lets a money route through; the value is never checked', () => {
    for (const cookie of ['__Host-sid=x', '__Host-sid=not-a-real-session', 'lang=es; __Host-sid=abc']) {
      const res = run('/overview', cookie);
      expect(res.status, cookie).toBe(200);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('T-WEB-7: other cookies do not count as a session', () => {
    for (const cookie of ['sid=x', '__Host-pre=x', '__host-sid=x', 'lang=en']) expect(run('/overview', cookie).status, cookie).toBe(307);
  });

  it('T-WEB-7: an auth route with __Host-sid goes to /overview', () => {
    for (const p of AUTH) {
      const res = run(p, '__Host-sid=x');
      expect(res.status, p).toBe(307);
      expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/overview');
    }
  });

  it('T-WEB-7: auth routes without the cookie and open routes pass through', () => {
    for (const p of [...AUTH, '/', '/privacy', '/terms', '/goodbye', '/api/health', '/api/lang']) {
      expect(run(p).status, p).toBe(200);
      expect(run(p).headers.get('x-middleware-next'), p).toBe('1');
    }
    for (const p of ['/privacy', '/terms', '/consent', '/api/health']) expect(run(p, '__Host-sid=x').status, p).toBe(200);
  });

  it('T-WEB-7: lookalike paths are not money or auth routes', () => {
    for (const p of ['/overviewx', '/data-export', '/sign-inx', '/resets']) expect(run(p).status, p).toBe(200);
    for (const p of ['/sign-inx', '/resets']) expect(run(p, '__Host-sid=x').status, p).toBe(200);
  });

  it('T-WEB-7: percent-encoded paths are matched after decoding', () => {
    const to = new URL(run('/%6Fverview').headers.get('location') ?? '');
    expect(to.pathname).toBe('/sign-in');
    expect(to.searchParams.get('next')).toBe('/%6Fverview');
    expect(new URL(run('/sign%2Din', '__Host-sid=x').headers.get('location') ?? '').pathname).toBe('/overview');
    expect(run('/%6Fverview', '__Host-sid=x').headers.get('cache-control')).toBe('no-store');
    expect(run('/%E0%A4%A').status).toBe(200);
  });

  it('T-WEB-7: next is the path as requested, never the decoded one', () => {
    const next = (p: string) => new URL(run(p).headers.get('location') ?? '').searchParams.get('next');
    expect(next('/overview/a%20b')).toBe('/overview/a%20b');
    expect(next('/imports/caf%C3%A9?x=1')).toBe('/imports/caf%C3%A9?x=1');
  });

  it('T-WEB-7: a path that decodes to dot segments, a double slash, a backslash, ? or # gets a bare /sign-in', () => {
    for (const p of [
      '/overview/..%2f..%2f/evil.com',
      '/overview/%2F%2Fevil.com',
      '/overview/%5C%5Cevil.com',
      '/overview/a%3Fb',
      '/overview/a%23b',
      '/overview//evil.com',
    ]) {
      const res = run(p);
      expect(res.status, p).toBe(307);
      const to = new URL(res.headers.get('location') ?? '');
      expect(to.origin, p).toBe(ORIGIN);
      expect(to.pathname, p).toBe('/sign-in');
      expect(to.search, p).toBe('');
    }
  });

  it('T-WEB-7: redirects carry the security headers too', () => {
    const res = run('/overview');
    expect(res.headers.get('content-security-policy')).toMatch(/'nonce-[^']+'/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('T-WEB-7: middleware imports no AWS SDK and no session code (D-108)', () => {
    const src = readFileSync(new URL('./middleware.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['next/server']);
  });
});
