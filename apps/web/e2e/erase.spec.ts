import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Your data: export and erase (SF-168; AC-7, AC-8, D-146). Erasing everything asks for the typed word DELETE, says
// backups keep it for 35 days, waits for the server's answer (no optimistic update, D-131) and shows the counts it
// erased. A timeout or a server failure says the erase may be unfinished and offers Finish erasing, the same action.
//
// Each test signs in as its own STAGE=test person (E2E_PEOPLE in src/adapters/container.ts) with a copy of the fixtures
// of its own: 561 transactions, 11 rates and 12 imports, so the memory data API erases 584 records and 12 files.
// data-erase-retry's first erase fails as a timeout would. A person may make 5 data reads a minute under STAGE=test.

type Person = 'data-erase' | 'data-erase-retry';

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

const main = (page: Page) => page.getByRole('main');

/** Opens the erase dialog and checks it waits for DELETE, typed exactly. Returns the dialog's confirm button. */
async function askToErase(page: Page) {
  await main(page).getByRole('button', { name: 'Delete everything' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete everything' });
  await expect(dialog).toContainText('Backups keep deleted records for 35 days');
  const confirm = dialog.getByRole('button', { name: 'Delete everything' });
  await expect(confirm).toBeDisabled();
  const word = dialog.getByLabel('Type DELETE to confirm');
  await word.fill('delete');
  await expect(confirm).toBeDisabled();
  await word.fill('DELETE');
  await expect(confirm).toBeEnabled();
  return confirm;
}

test('T-WSCR-10: erasing needs DELETE, says 35 days and shows the counts it erased', async ({ page, context }) => {
  await signInAs(context, 'data-erase');
  const violations = watchPolicy(page);
  await page.goto('/data');
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Your data');
  // The export is a plain download of every transaction (GET /api/data/export).
  await expect(main(page).getByRole('link', { name: 'Download CSV' })).toHaveAttribute('href', '/api/data/export');
  await expect(main(page)).toContainText('35 days');

  const confirm = await askToErase(page);
  await confirm.click();
  const done = main(page).getByRole('status').filter({ hasText: 'Everything is deleted.' });
  await expect(done).toBeVisible();
  await expect(done.getByRole('definition').nth(0)).toHaveText('584');
  await expect(done.getByRole('definition').nth(1)).toHaveText('12');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // Nothing is left to show.
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Transactions' }).click();
  await expect(main(page).getByRole('heading', { name: 'No transactions match' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('T-WSCR-10: an erase that times out may be unfinished, and Finish erasing completes it', async ({ page, context }) => {
  await signInAs(context, 'data-erase-retry');
  const violations = watchPolicy(page);
  await page.goto('/data');
  const confirm = await askToErase(page);
  await confirm.click();

  const unfinished = main(page).getByRole('alert');
  await expect(unfinished).toContainText('The erase may not have finished');
  await expect(main(page).getByRole('status').filter({ hasText: 'Everything is deleted.' })).toHaveCount(0);
  await unfinished.getByRole('button', { name: 'Finish erasing' }).click();

  const done = main(page).getByRole('status').filter({ hasText: 'Everything is deleted.' });
  await expect(done).toBeVisible();
  await expect(done.getByRole('definition').nth(0)).toHaveText('584');
  await expect(main(page).getByRole('alert')).toHaveCount(0);
  expect(violations).toEqual([]);
});
