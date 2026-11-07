import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// The transactions island (SF-165; AC-6, D-82, D-127): the server prefetches the first page; then every filter, sort
// and page change asks the data route for that page, without a page load, and keeps month, kind, category and sort in
// the address. Free text stays in the form: it goes to the data route only, never into the page address (D-82).
//
// Each test signs in as its own STAGE=test person (E2E_PEOPLE in src/adapters/container.ts), so its reads stay within
// the 5 a minute the test stage allows. The sample data (apps/web/fixtures) has 51 rows in 2026-08, 49 of them expenses.

type Person = 'transactions-paging' | 'transactions-sort' | 'transactions-signed-out';

async function signInAs(context: BrowserContext, person: Person) {
  // Chrome counts localhost as secure, so a Secure cookie set for the https form of the address is sent over http too.
  await context.addCookies([
    {
      name: '__Host-sid',
      value: `e2e-${person}-not-secret-`.padEnd(43, '0'),
      url: 'https://localhost:3000/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

// Every Content-Security-Policy violation the page logs or throws (style-src has no 'unsafe-inline', SF-107).
function watchPolicy(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (/Content Security Policy/i.test(e.message)) violations.push(e.message);
  });
  return violations;
}

/** The data requests for transactions, as their search values, and the page loads (documents). */
function watchRequests(page: Page) {
  const data: URLSearchParams[] = [];
  const documents: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/data/transactions') data.push(url.searchParams);
    if (r.resourceType() === 'document') documents.push(r.url());
  });
  return { data, documents };
}

const rows = (page: Page) => page.getByRole('main').getByRole('table').locator('tbody tr');
const search = (page: Page) => new URL(page.url()).searchParams;

async function pick(page: Page, field: string, option: string) {
  await page
    .getByRole('main')
    .getByRole('button', { name: new RegExp(field) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('T-WSCR-6: paging and each filter ask for that page, keep the address in sync and load no page', async ({ page, context }) => {
  await signInAs(context, 'transactions-paging');
  const violations = watchPolicy(page);
  const seen = watchRequests(page);

  const res = await page.goto('/transactions?month=2026-08');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Transactions');
  // The first page (50, date descending) came with the page: hydrating asks for nothing.
  await expect(rows(page)).toHaveCount(50);
  await page.waitForLoadState('networkidle');
  expect(seen.data).toHaveLength(0);

  // The next page by the cursor.
  await page.getByRole('button', { name: 'Show the next 50' }).click();
  await expect(rows(page)).toHaveCount(51);
  await expect(page.getByRole('button', { name: 'Show the next 50' })).toHaveCount(0);
  expect(seen.data).toHaveLength(1);
  expect(Object.fromEntries(seen.data[0]!)).toMatchObject({ from: '2026-08', to: '2026-08', sort: 'date', order: 'desc', limit: '50', cursor: '50' });

  // A kind: one request for that page, the kind in the address.
  await pick(page, 'Kind', 'expense');
  await expect(rows(page)).toHaveCount(49);
  expect(seen.data).toHaveLength(2);
  expect(seen.data[1]!.get('kind')).toBe('expense');
  expect(seen.data[1]!.get('cursor')).toBeNull();
  expect(search(page).get('kind')).toBe('expense');
  expect(search(page).get('month')).toBe('2026-08');

  // A category on top: one more request, both in the address.
  await pick(page, 'Category', 'Home');
  await expect(rows(page)).toHaveCount(5);
  expect(seen.data).toHaveLength(3);
  expect(Object.fromEntries(seen.data[2]!)).toMatchObject({ kind: 'expense', category: 'Home' });
  expect(Object.fromEntries(search(page))).toEqual({ month: '2026-08', kind: 'expense', category: 'Home' });

  // None of it loaded a page.
  expect(seen.documents).toHaveLength(1);
  expect(violations).toEqual([]);
});

test('T-WSCR-6: sort and month ask for that page and go in the address; free text never enters the address', async ({ page, context }) => {
  await signInAs(context, 'transactions-sort');
  const violations = watchPolicy(page);
  const seen = watchRequests(page);

  // The sort from the address is the one prefetched: the biggest spending first.
  await page.goto('/transactions?month=2026-08&sort=amount-asc');
  await expect(rows(page)).toHaveCount(50);
  const amount = page.getByRole('main').getByRole('columnheader', { name: 'Amount' });
  await expect(amount).toHaveAttribute('aria-sort', 'ascending');
  await page.waitForLoadState('networkidle');
  expect(seen.data).toHaveLength(0);

  // The other direction.
  await amount.getByRole('button').click();
  await expect(amount).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => seen.data.length).toBe(1);
  expect(Object.fromEntries(seen.data[0]!)).toMatchObject({ sort: 'amount', order: 'desc' });
  expect(search(page).get('sort')).toBe('amount-desc');

  // Another month in the picker.
  await page
    .getByRole('main')
    .getByRole('button', { name: /August 2026/ })
    .click();
  await page.getByRole('button', { name: 'Sep 2026' }).click();
  await expect.poll(() => seen.data.length).toBe(2);
  expect(Object.fromEntries(seen.data[1]!)).toMatchObject({ from: '2026-09', to: '2026-09', sort: 'amount', order: 'desc' });
  expect(Object.fromEntries(search(page))).toEqual({ month: '2026-09', sort: 'amount-desc' });
  await expect(rows(page)).toHaveCount(50);

  // Free text: sent to the data route, kept out of the page address.
  const form = page.getByRole('search');
  await form.getByRole('searchbox', { name: 'Search' }).fill('Coto');
  await form.getByRole('button', { name: 'Search' }).click();
  await expect.poll(() => seen.data.length).toBe(3);
  expect(seen.data[2]!.get('q')).toBe('Coto');
  await expect(rows(page).first()).toContainText('Coto');
  expect(page.url()).not.toContain('Coto');
  expect(search(page).has('q')).toBe(false);

  expect(seen.documents).toHaveLength(1);
  expect(violations).toEqual([]);
});

test('T-WSCR-6: a browser read answered 401 opens sign-in with the address kept', async ({ page, context }) => {
  // transactions-signed-out's data API serves the shell count and the prefetch, then refuses its token (as the real one
  // does after its one refresh fails): the next read in the browser is a 401 and the person goes to sign-in with the
  // address as it was then.
  await signInAs(context, 'transactions-signed-out');
  const violations = watchPolicy(page);
  await page.goto('/transactions?month=2026-08');
  await expect(rows(page)).toHaveCount(50);
  await page.waitForLoadState('networkidle');

  await page.getByRole('main').getByRole('columnheader', { name: 'Amount' }).getByRole('button').click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Ftransactions%3Fmonth%3D2026-08%26sort%3Damount-asc$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  expect((await context.cookies()).map((c) => c.name)).not.toContain('__Host-sid');
  expect(violations).toEqual([]);
});
