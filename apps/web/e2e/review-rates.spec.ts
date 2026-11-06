import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

// To review and Dollar rates (SF-166): a review choice or a rate shows at once and rolls back with a plain message when
// the server refuses it (D-131); both screens say when they are empty or failed, and rows from a source other than
// Mercado Pago point to the file instead of offering a choice (AC-8).
//
// Each test signs in as its own STAGE=test person (E2E_PEOPLE in src/adapters/container.ts), with a copy of the
// fixtures of its own, so a choice made here never shows in another test; review-empty and rates-empty have no data,
// review-failed and rates-failed a data API that fails. A person may make 5 data reads a minute under STAGE=test.

type Person =
  | 'review-approve'
  | 'review-category'
  | 'review-rollback'
  | 'review-source'
  | 'review-empty'
  | 'review-failed'
  | 'rates-save'
  | 'rates-rollback'
  | 'rates-empty'
  | 'rates-failed';

test.use({ viewport: { width: 1280, height: 900 } });

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

const isAction = (route: Route) => route.request().method() === 'POST' && route.request().headers()['next-action'] !== undefined;

/** Holds the screen's server action posts until release() is called, so what shows before the answer can be checked. */
async function holdActions(page: Page, path: string) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${path}`, async (route) => {
    if (isAction(route)) await gate;
    await route.continue();
  });
  return () => release();
}

/** The screen's server action posts fail as a dropped connection would. */
async function refuseActions(page: Page, path: string) {
  await page.route(`**${path}`, async (route) => (isAction(route) ? route.abort('failed') : route.continue()));
}

const main = (page: Page) => page.getByRole('main');
const reviewLink = (page: Page) => page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: /To review/ });
const approveRows = (page: Page) =>
  main(page)
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Approve' }) });

test('T-WSCR-19: an approval shows at once, and the to-review count follows once it is saved', async ({ page, context }) => {
  await signInAs(context, 'review-approve');
  const violations = watchPolicy(page);
  await page.goto('/review');
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('To review');
  // 72 rows wait in the fixtures; the rail carries the count from every screen (D-44).
  await expect(reviewLink(page)).toContainText('72 to review');
  const before = await approveRows(page).count();
  expect(before).toBeGreaterThan(1);

  const release = await holdActions(page, '/review');
  await approveRows(page).first().getByRole('button', { name: 'Approve' }).click();
  // Before the server answers, the row is gone (D-131).
  await expect(approveRows(page)).toHaveCount(before - 1, { timeout: 1_000 });
  release();
  await expect(reviewLink(page)).toContainText('71 to review');
  await expect(approveRows(page)).toHaveCount(before - 1);
  await expect(main(page).getByRole('alert')).toHaveCount(0);
  expect(violations).toEqual([]);
});

test('T-WSCR-19: a category choice shows at once on its row', async ({ page, context }) => {
  await signInAs(context, 'review-category');
  const violations = watchPolicy(page);
  await page.goto('/review');
  const row = approveRows(page).first();
  await expect(row).toContainText('Mercado Pago · Uncategorized');

  const release = await holdActions(page, '/review');
  await row.getByRole('button', { name: /Categorize/ }).click();
  await page.getByRole('option', { name: 'Groceries', exact: true }).click();
  await expect(row).toContainText('Mercado Pago · Groceries', { timeout: 1_000 });
  release();
  await expect(row).toContainText('Mercado Pago · Groceries');
  await expect(main(page).getByRole('alert')).toHaveCount(0);
  expect(violations).toEqual([]);
});

test('T-WSCR-19: a refused approval comes back with a plain message', async ({ page, context }) => {
  await signInAs(context, 'review-rollback');
  const violations = watchPolicy(page);
  await page.goto('/review');
  const before = await approveRows(page).count();
  await refuseActions(page, '/review');
  await approveRows(page).first().getByRole('button', { name: 'Approve' }).click();
  await expect(main(page).getByRole('alert')).toHaveText('That change didn’t save. Nothing changed; try again.');
  await expect(approveRows(page)).toHaveCount(before);
  await expect(reviewLink(page)).toContainText('72 to review');
  expect(violations).toEqual([]);
});

test('T-WSCR-7: rows from another source point to the file instead of offering a choice', async ({ page, context }) => {
  await signInAs(context, 'review-source');
  const violations = watchPolicy(page);
  await page.goto('/review');
  const notes = main(page).getByRole('row').filter({ hasText: 'Fix in the notes log' });
  await expect(notes.first()).toBeVisible();
  await expect(notes.first().getByRole('button')).toHaveCount(0);
  await expect(main(page).getByRole('row').filter({ hasText: 'Fix in the monthly budget' }).first()).toBeVisible();
  // Each row says why it is here, in words, beside the importer's flag.
  await expect(approveRows(page).first()).toContainText('No category, or a transfer that may be spending');
  expect(violations).toEqual([]);
});

test('T-WSCR-7: nothing to review says so and points to imports', async ({ page, context }) => {
  await signInAs(context, 'review-empty');
  await page.goto('/review');
  await expect(main(page).getByRole('heading', { level: 2 })).toHaveText('Nothing to review');
  await expect(main(page).getByRole('link', { name: 'Open imports' })).toHaveAttribute('href', '/imports');
  // No count when nothing waits (D-44).
  await expect(reviewLink(page)).toHaveText('To review');
});

test('T-WSCR-7: a review list that cannot load says so with a retry', async ({ page, context }) => {
  test.setTimeout(45_000);
  await signInAs(context, 'review-failed');
  await page.goto('/review');
  await expect(main(page).getByRole('heading', { level: 2 })).toHaveText('Couldn’t load this screen.', { timeout: 20_000 });
  await expect(main(page).getByRole('button', { name: 'Try again' })).toBeVisible();
});

const rateRow = (page: Page, month: string) => main(page).getByRole('row').filter({ hasText: month });

test('T-WSCR-19: a new rate shows as saved at once, with two decimals', async ({ page, context }) => {
  await signInAs(context, 'rates-save');
  const violations = watchPolicy(page);
  await page.goto('/rates');
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Dollar rates');
  // Months with data, newest first; October 2026 has no rate in the fixtures.
  const october = rateRow(page, 'October 2026');
  await expect(october).toContainText('Missing');
  await expect(rateRow(page, 'September 2026').getByRole('textbox')).toHaveValue('1,424.37');

  const release = await holdActions(page, '/rates');
  const input = october.getByRole('textbox', { name: 'Pesos per dollar · October 2026' });
  await input.fill('1450.5');
  await input.press('Enter');
  await expect(october).toContainText('saved', { timeout: 1_000 });
  await expect(october).not.toContainText('Missing');
  release();
  await expect(input).toHaveValue('1,450.50');
  await expect(october).toContainText('saved');
  await expect(main(page).getByRole('alert')).toHaveCount(0);

  // More than two decimals is refused before anything is sent.
  await input.fill('1450.555');
  await input.press('Enter');
  await expect(october.getByText('Use a number above 0 with at most two decimals, like 1,424.37.')).toBeVisible();
  expect(violations).toEqual([]);
});

test('T-WSCR-19: a refused rate goes back to missing with a plain message', async ({ page, context }) => {
  await signInAs(context, 'rates-rollback');
  const violations = watchPolicy(page);
  await page.goto('/rates');
  const october = rateRow(page, 'October 2026');
  await refuseActions(page, '/rates');
  const input = october.getByRole('textbox', { name: 'Pesos per dollar · October 2026' });
  await input.fill('1450');
  await input.press('Enter');
  await expect(main(page).getByRole('alert')).toHaveText('That rate didn’t save. Nothing changed; try again.');
  await expect(october).toContainText('Missing');
  expect(violations).toEqual([]);
});

test('T-WSCR-7: no months to rate says so', async ({ page, context }) => {
  await signInAs(context, 'rates-empty');
  await page.goto('/rates');
  await expect(main(page).getByRole('heading', { level: 2 })).toHaveText('No months to rate');
});

test('T-WSCR-7: rates that cannot load say so with a retry', async ({ page, context }) => {
  test.setTimeout(45_000);
  await signInAs(context, 'rates-failed');
  await page.goto('/rates');
  await expect(main(page).getByRole('heading', { level: 2 })).toHaveText('Couldn’t load this screen.', { timeout: 20_000 });
  await expect(main(page).getByRole('button', { name: 'Try again' })).toBeVisible();
});
