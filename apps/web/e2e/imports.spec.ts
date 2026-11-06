import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Imports (SF-167): a file is checked against its source's name and size rules, sent to the presigned upload form, and
// its import is shown until it ends, with each skipped row and its reason (AC-5): a translated lead, then the importer's
// own words as it wrote them, in English (D-86). A refused file says why, and nothing is sent.
//
// Each test signs in as its own STAGE=test person (E2E_PEOPLE in src/adapters/container.ts), with a copy of the
// fixtures of its own; a person may make 5 data reads a minute under STAGE=test. The memory data API answers an import
// request with a form for https://uploads.test.invalid/, which these tests answer in place of the upload host, and
// finishes that import 2 seconds after it was requested, with two skipped rows.

type Person = 'imports-upload' | 'imports-refused' | 'imports-es';

test.use({ viewport: { width: 1280, height: 900 } });

async function signInAs(context: BrowserContext, person: Person) {
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
const csv = (name: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('date,amount,description\n2026-11-02,-1000,SYNTHETIC SHOP\n') });

test('T-WSCR-9: a sent file shows its import until it ends, with the skipped rows and their reasons', async ({ page, context }) => {
  test.setTimeout(60_000);
  await signInAs(context, 'imports-upload');
  const violations = watchPolicy(page);
  const uploads: { method: string; body: string }[] = [];
  await page.route('https://uploads.test.invalid/**', async (route) => {
    uploads.push({ method: route.request().method(), body: route.request().postData() ?? '' });
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': 'http://localhost:3000' } });
  });

  await page.goto('/imports');
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Imports');
  await expect(main(page).getByText('The monthly release report as CSV. One month per file, up to 5 MiB.')).toBeVisible();
  await main(page).getByLabel('Choose a file').setInputFiles(csv('release-report-2026-11.csv'));

  // The import of this file opens, and its status is shown until it is final.
  const detail = main(page).getByRole('complementary', { name: 'release-report-2026-11.csv' });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Done', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(detail.getByText('2 rows were skipped; the rest came in.')).toBeVisible();
  await expect(detail.getByText('row 7')).toBeVisible();
  await expect(detail.getByText('the amount is not a number')).toBeVisible();
  await expect(detail.getByText('row 12')).toBeVisible();

  // The file went to the presigned form once, with the form's fields and the file last.
  expect(uploads).toHaveLength(1);
  expect(uploads[0]!.method).toBe('POST');
  expect(uploads[0]!.body).toContain('name="key"');
  expect(uploads[0]!.body).toContain('SYNTHETIC SHOP');
  // The list shows it too, at the top.
  await expect(main(page).getByRole('table').getByRole('row').nth(1)).toContainText('release-report-2026-11.csv');
  expect(violations).toEqual([]);
});

test('T-WSCR-9: a file whose name does not fit its source is refused with the reason, and nothing is sent', async ({ page, context }) => {
  await signInAs(context, 'imports-refused');
  const violations = watchPolicy(page);
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  await page.goto('/imports');
  await main(page)
    .getByRole('button', { name: /Where is this file from/ })
    .click();
  await page.getByRole('option', { name: 'Monthly budget' }).click();
  await expect(main(page).getByText(/A monthly budget whose name ends in the month and year/)).toBeVisible();
  await main(page)
    .getByLabel('Choose a file')
    .setInputFiles({ name: 'budget.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('synthetic') });
  await expect(main(page).getByRole('alert')).toHaveText('The file name needs the month and year, like budget_Jun_2026.xlsx.');
  expect(posts).toEqual([]);

  // An import that stopped partway says so and what fixes it.
  await main(page).getByRole('button', { name: 'notes-log-export.md' }).click();
  const stalled = main(page).getByRole('complementary', { name: 'notes-log-export.md' });
  await expect(stalled.getByText('This import stopped partway.')).toBeVisible();
  expect(violations).toEqual([]);
});

test('T-WSCR-9: skipped rows keep the importer’s own words in English under a translated lead (D-86)', async ({ page, context }) => {
  await signInAs(context, 'imports-es');
  await context.addCookies([{ name: 'lang', value: 'es', url: 'http://localhost:3000/' }]);
  await page.goto('/imports');
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Importaciones');
  await main(page).getByRole('button', { name: 'release-report-2026-09.csv' }).click();
  const detail = main(page).getByRole('complementary', { name: 'release-report-2026-09.csv' });
  await expect(detail.getByText('Se omitieron 3 filas; el resto entró.')).toBeVisible();
  await expect(detail.getByText('amount is not a number')).toBeVisible();
  await expect(detail.getByText('el monto no es un número')).toHaveCount(0);
});
