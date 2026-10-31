import { expect, test, type Page } from '@playwright/test';

// T-WEB-12: one not-found screen for anything a person cannot open (AC-8, AC-15, D-101), and the sign-in placeholder's
// idle notice. Pages answer another person's resource exactly like a missing one (notFound(), the same screen and status),
// so a stranger cannot tell "not yours" from "not there". PR 1 has no data routes yet, so a missing public page and a
// missing resource under a money screen stand in for both cases.

const SESSION = {
  name: '__Host-sid',
  value: 'e2e-dummy-session',
  url: 'https://localhost:3000/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax' as const,
};

// style-src has no 'unsafe-inline' (SF-107), so a screen that renders a style attribute logs a violation.
function watchStylePolicy(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text()) && /style-src/.test(m.text())) violations.push(m.text());
  });
  return violations;
}

async function screenOf(page: Page) {
  const main = page.getByRole('main');
  return {
    heading: await main.getByRole('heading', { level: 1 }).textContent(),
    text: (await main.innerText()).trim(),
    link: await main.getByRole('link').getAttribute('href'),
  };
}

test('T-WEB-12: a missing page shows the not-found screen with a link to the overview, status 404', async ({ page }) => {
  const violations = watchStylePolicy(page);
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('We can’t find that page');
  await expect(main.getByText('The address may be old or mistyped. Your money is exactly where you left it.')).toBeVisible();
  const go = main.getByRole('link', { name: 'Go to the overview' });
  await expect(go).toHaveAttribute('href', '/overview');
  await expect(page.locator('h1')).toHaveCount(1);
  expect(violations).toEqual([]);
});

test("T-WEB-12: a resource that is missing or someone else's shows the same not-found screen as a missing page", async ({ page, context }) => {
  await page.goto('/no-such-page');
  const missing = await screenOf(page);

  await context.addCookies([SESSION]);
  const res = await page.goto('/transactions/another-persons-row');
  expect(res?.status()).toBe(404);
  expect(await screenOf(page)).toEqual(missing);
});

test('T-WEB-12: the not-found screen follows the language', async ({ page, context }) => {
  await context.addCookies([{ name: 'lang', value: 'es', url: 'http://localhost:3000/' }]);
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No encontramos esa página');
  await expect(page.getByRole('link', { name: 'Ir al resumen' })).toHaveAttribute('href', '/overview');
});

test('T-WEB-12: sign-in with reason=idle shows the idle sign-out notice', async ({ page }) => {
  const violations = watchStylePolicy(page);
  const res = await page.goto('/sign-in?reason=idle');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  const notice = page.getByRole('status');
  await expect(notice).toHaveText('You were signed out after 30 minutes without activity. Sign in to pick up where you left off.');
  expect(violations).toEqual([]);
});

test('T-WEB-12: sign-in without reason=idle shows no idle notice', async ({ page }) => {
  for (const path of ['/sign-in', '/sign-in?reason=other', '/sign-in?next=%2Ftransactions']) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
    await expect(page.getByText(/signed out after 30 minutes/)).toHaveCount(0);
  }
});

test('T-WEB-12: a money page without the session cookie lands on the sign-in placeholder, not a 404', async ({ page }) => {
  const res = await page.goto('/overview');
  expect(new URL(page.url()).pathname).toBe('/sign-in');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
});
