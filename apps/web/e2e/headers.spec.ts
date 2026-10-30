import { expect, test } from '@playwright/test';

const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1] ?? '';

test('T-WEB-8: every page response carries the content policy with a fresh nonce', async ({ request }) => {
  const a = await request.get('/sign-in', { maxRedirects: 0 });
  const b = await request.get('/sign-in', { maxRedirects: 0 });
  for (const res of [a, b]) {
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['referrer-policy']).toBe('no-referrer');
  }
  expect(nonceOf(a.headers()['content-security-policy'] ?? '')).not.toBe(nonceOf(b.headers()['content-security-policy'] ?? ''));
});

test('T-WEB-8: a money route without the session cookie redirects to sign-in', async ({ request }) => {
  const res = await request.get('/overview?month=2026-05', { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const to = new URL(res.headers()['location'] ?? '', 'http://localhost:3000');
  expect(to.pathname).toBe('/sign-in');
  expect(to.searchParams.get('next')).toBe('/overview?month=2026-05');
});

test('T-WEB-8: in a browser, an inline script without the nonce does not run', async ({ page }) => {
  // Serve injected markup under the policy the app actually sent (only that header is replayed), a body with
  // one inline script carrying the nonce (control), two without it (a guessed nonce and none), and an inline handler.
  let nonce = '';
  await page.route('**/sign-in', async (route) => {
    const real = await route.fetch({ maxRedirects: 0 });
    const policy = real.headers()['content-security-policy'] ?? '';
    nonce = nonceOf(policy);
    expect(nonce).not.toBe('');
    const body = `<!doctype html><html><head><title>probe</title></head><body>
      <script nonce="${nonce}">window.__withNonce = true;</script>
      <script>window.__noNonce = true;</script>
      <script nonce="guessed">window.__wrongNonce = true;</script>
      <img src="x" onerror="window.__handler = true">
    </body></html>`;
    await route.fulfill({ status: 200, headers: { 'content-security-policy': policy, 'content-type': 'text/html; charset=utf-8' }, body });
  });

  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/sign-in');

  const ran = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return { withNonce: w.__withNonce === true, noNonce: w.__noNonce === true, wrongNonce: w.__wrongNonce === true, handler: w.__handler === true };
  });
  expect(ran).toEqual({ withNonce: true, noNonce: false, wrongNonce: false, handler: false });
  expect(violations.length).toBeGreaterThanOrEqual(2);
});

test("T-WEB-8: the app's own scripts run under the policy without a script violation", async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text()) && /script-src/.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto('/sign-in');
  expect(res?.headers()['content-security-policy']).toContain("'nonce-");
  const nonce = nonceOf(res?.headers()['content-security-policy'] ?? '');
  const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.nonce));
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((n) => n === nonce)).toBe(true);
  expect(violations).toEqual([]);
});
