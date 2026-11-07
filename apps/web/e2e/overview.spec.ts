import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// The overview (SF-164): the server prefetches every section's data and hydrates the island, so the first view needs no
// browser request (D-101, D-127); it opens with what you kept against your typical month (AC-2, D-18, D-19), each
// section fails alone with its own retry (AC-8, D-101), and in a bad month exactly one money figure is red (AC-11, D-63).
//
// Each test signs in as its own STAGE=test person (E2E_PEOPLE in src/adapters/container.ts): a person may make 5 data
// reads a minute under STAGE=test, and one overview first view makes exactly 5 (totals, rates, review, imports, places).
// The sample data (apps/web/fixtures): 2026-09 kept 31.7% against a typical 19.5%; 2026-03 spent more than it earned.

type Person = 'overview-good' | 'overview-bad' | 'overview-failed' | 'overview-retry' | 'overview-signed-out';

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

const main = (page: Page) => page.getByRole('main');
const section = (page: Page, name: string) => main(page).locator(`[data-section="${name}"]`);

test('T-WSCR-4: the overview opens with what you kept against your typical month, then what waits, where it went, over time and places', async ({
  page,
  context,
}) => {
  await signInAs(context, 'overview-good');
  const violations = watchPolicy(page);
  const dataRequests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/data/')) dataRequests.push(r.url());
  });

  const res = await page.goto('/overview?month=2026-09');
  expect(res?.status()).toBe(200);
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Overview');

  // The answer comes first, as one headline: the kept share, whole percent (D-30), then the typical month in exact points.
  const headings = main(page).getByRole('heading', { level: 2 });
  await expect(headings.first()).toHaveText(/^You kept\s*32%$/);
  const kept = section(page, 'kept');
  await expect(kept.getByText('12.1 points better than your typical month.')).toBeVisible();
  await expect(kept.getByRole('img', { name: 'You spent 68% of what you earned and kept 32%.' })).toBeVisible();
  await expect(kept.locator('[data-money]').first()).toBeVisible();
  // Earned in pesos at the month's rate, with the dollars received under it (D-31).
  await expect(kept.getByText('USD 1,922.00 at ARS 1,424.37 per dollar')).toBeVisible();

  // One column, top to bottom (D-18): kept, the waiting line, where it went, over time, places. Each opens with a finding.
  const order = await main(page)
    .locator('[data-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
  expect(order).toEqual(['kept', 'waiting', 'where', 'time', 'places']);
  await expect(headings).toHaveText([
    /^You kept\s*32%$/,
    /took \d+ of every 10 pesos\.$/,
    /^You kept something in \d+ of the last \d+ months\./,
    /^You spent the most at /,
  ]);
  await expect(section(page, 'waiting').getByRole('list', { name: 'Waiting for you' })).toBeVisible();
  await expect(section(page, 'waiting').getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/review');

  // The band strip heads where it went; the chart has its table alternative (D-57).
  await expect(section(page, 'where').getByRole('img', { name: /each band a category/ })).toBeVisible();
  const time = section(page, 'time');
  await expect(time.getByRole('img')).toBeVisible();
  await time.getByText('Chart as a table').click();
  await expect(time.getByRole('table')).toBeVisible();
  await expect(time.getByRole('row')).toHaveCount(12); // the header and 11 months with data (2025-11 to 2026-09)

  // Net worth stays hidden (D-18); no money figure is red in a good month (AC-11).
  await expect(main(page).getByText('Net worth')).toHaveCount(0);
  await expect(page.locator('[data-money][data-tone="bad"]')).toHaveCount(0);

  // The server prefetched everything: hydrating asks the data routes for nothing.
  await page.waitForLoadState('networkidle');
  expect(dataRequests).toEqual([]);
  expect(violations).toEqual([]);
});

test('T-WSCR-4: a section that fails shows its own note with a retry, and the other sections stay', async ({ page, context }) => {
  test.setTimeout(60_000);
  await signInAs(context, 'overview-failed');
  const violations = watchPolicy(page);
  await page.goto('/overview?month=2026-03');
  await expect(main(page).getByRole('heading', { level: 2 }).first()).toHaveText(/^You came up short/);

  // Another month in the picker: only the places read is new (the totals cover three years), and it fails.
  let failures = 0;
  await page.route('**/api/data/transactions**', async (route) => {
    failures++;
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'failed' } }) });
  });
  await main(page)
    .getByRole('button', { name: /March 2026/ })
    .click();
  await page.getByRole('button', { name: 'Sep 2026' }).click();
  await expect(page).toHaveURL(/\/overview\?month=2026-09$/);

  const places = section(page, 'places');
  await expect(places.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 20_000 });
  await expect(places.getByText('This part of the overview didn’t load.')).toBeVisible();
  expect(failures).toBe(3); // the first try and two retries (5xx only)

  // The other sections are there, for the new month.
  await expect(main(page).getByRole('heading', { level: 2 }).first()).toHaveText(/^You kept\s*32%$/);
  for (const name of ['kept', 'waiting', 'where', 'time']) await expect(section(page, name)).toBeVisible();
  await expect(section(page, 'where').getByRole('heading', { level: 2 })).toHaveText(/took \d+ of every 10 pesos\.$/);
  await expect(page.locator('[data-money][data-tone="bad"]')).toHaveCount(0);

  // Its own retry asks again; as a person with reads left (the first one spent its 5 this minute), it fills in.
  await page.unroute('**/api/data/transactions**');
  await signInAs(context, 'overview-retry');
  await places.getByRole('button', { name: 'Try again' }).click();
  await expect(places.getByRole('heading', { level: 2 })).toHaveText(/^You spent the most at /);
  expect(violations).toEqual([]);
});

test('T-WSCR-5: in 2026-03 exactly one money figure is red, with one plain sentence', async ({ page, context }) => {
  await signInAs(context, 'overview-bad');
  const violations = watchPolicy(page);
  await page.goto('/overview?month=2026-03');

  const kept = section(page, 'kept');
  await expect(main(page).getByRole('heading', { level: 2 }).first()).toHaveText(/^You came up short\s*−58%$/);
  await expect(kept.getByText(/^You spent ARS 1,434,032 more than you earned\./)).toBeVisible();
  await expect(kept.getByRole('img', { name: 'You spent ARS 1,434,032 more than you earned.' })).toBeVisible();

  const bad = page.locator('[data-money][data-tone="bad"]');
  await expect(bad).toHaveCount(1);
  await expect(bad).toHaveText('−58%');
  const figures = page.locator('[data-money]');
  expect(await figures.count()).toBeGreaterThan(5);
  const colours = await figures.evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  const red = await bad.evaluate((e) => getComputedStyle(e).color);
  expect(red).toBe('rgb(255, 107, 95)'); // --field-red on the ink field (D-21)
  expect(colours.filter((c) => c === red)).toHaveLength(1);
  expect(violations).toEqual([]);
});

test('T-WSCR-4: a token the data API refuses signs the person out and opens sign-in with the address kept', async ({ page, context }) => {
  // overview-signed-out has a live session, but the STAGE=test data API refuses its token (as the real one does after
  // its one refresh fails): the prefetch ends the session and the person lands on sign-in with this address kept.
  await signInAs(context, 'overview-signed-out');
  const violations = watchPolicy(page);
  const browserReads: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() !== 'document' && new URL(r.url()).pathname.startsWith('/api/data/')) browserReads.push(r.url());
  });
  await page.goto('/overview?month=2026-09');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Foverview%3Fmonth%3D2026-09$/);
  // The server sent it there: the overview never rendered, so no section asked again in the browser.
  expect(browserReads).toEqual([]);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  expect((await context.cookies()).map((c) => c.name)).not.toContain('__Host-sid');
  expect(violations).toEqual([]);
});
