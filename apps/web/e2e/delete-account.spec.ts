import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Delete the account (SF-169; AC-18, D-104, D-146). The page asks for a full re-sign-in (email, password and the
// authenticator code) and the typed word DELETE; then the account is marked deleting, the data erased, every session
// ended, the sign-in removed and the account row deleted, and the person lands signed out on /goodbye, which shows the
// counts from a 5-minute signed cookie. A failed erase keeps the person on the page with Finish deleting.
//
// Each test uses its own STAGE=test person (E2E_PEOPLE in src/adapters/container.ts), whose sign-in the memory identity
// provider holds with E2E_DELETE_PASSWORD (the authenticator code is 000000 for everyone). delete-account-retry's first
// erases fail as timeouts would. A person whose account is deleted is never used by another test.

type Person = 'delete-account' | 'delete-account-refused' | 'delete-account-retry';

/** The synthetic password container.ts seeds for these people (E2E_DELETE_PASSWORD); no secret. */
const PASSWORD = 'e2e delete phrase, not a secret';
const AUTHENTICATOR_CODE = '000000';
const sessionId = (person: Person) => `e2e-${person}-not-secret-`.padEnd(43, '0');

test.use({ viewport: { width: 1280, height: 900 } });

async function signInAs(context: BrowserContext, person: Person) {
  // Chrome counts localhost as secure, so a Secure cookie set for the https form of the address is sent over http too.
  await context.addCookies([
    { name: '__Host-sid', value: sessionId(person), url: 'https://localhost:3000/', secure: true, httpOnly: true, sameSite: 'Lax' },
  ]);
  // Its own address prefix, so the sign-in failure counter (per email and prefix) is this test's alone.
  const [a, b] = crypto.getRandomValues(new Uint8Array(2));
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${a}.${b}.9` });
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

/** Opens the delete page from Your data and fills the re-sign-in and DELETE; the delete button waits for DELETE. */
async function fillDelete(page: Page, person: Person, opts: { code?: string } = {}) {
  await page.goto('/data');
  await main(page).getByRole('link', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/data\/delete$/);
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Delete your account');
  await expect(main(page)).toContainText('Backups keep your data for 35 days');
  await expect(main(page).getByRole('heading', { name: 'Confirm it’s you' })).toBeVisible();
  await expect(main(page).getByLabel('Email')).toHaveValue(`${person}@example.com`);
  await main(page).getByLabel('Password').fill(PASSWORD);
  await main(page)
    .getByLabel('Six-digit code')
    .fill(opts.code ?? AUTHENTICATOR_CODE);
  const submit = main(page).getByRole('button', { name: 'Delete my account' });
  await expect(submit).toBeDisabled();
  await main(page).getByLabel('Type DELETE to confirm').fill('DELETE');
  await expect(submit).toBeEnabled();
  return submit;
}

test('T-WSCR-12: deleting the account needs a full re-sign-in and ends signed out on the page with the counts', async ({ page, context }) => {
  await signInAs(context, 'delete-account');
  const violations = watchPolicy(page);
  const submit = await fillDelete(page, 'delete-account');
  await submit.click();

  await expect(page).toHaveURL(/\/goodbye$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account is deleted');
  const counts = page.getByRole('main').getByRole('definition');
  await expect(counts.nth(0)).toHaveText('584');
  await expect(counts.nth(1)).toHaveText('12');
  // Signed out in this browser: the session cookie is gone, so a money screen asks to sign in.
  await page.goto('/overview');
  await expect(page).toHaveURL(/\/sign-in/);
  // And the old session itself is ended everywhere: the same cookie no longer opens anything.
  await context.addCookies([
    { name: '__Host-sid', value: sessionId('delete-account'), url: 'https://localhost:3000/', secure: true, httpOnly: true, sameSite: 'Lax' },
  ]);
  await page.goto('/data');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your session ended');
  expect(violations).toEqual([]);
});

test('T-WSCR-12: a wrong code deletes nothing and says so', async ({ page, context }) => {
  await signInAs(context, 'delete-account-refused');
  const violations = watchPolicy(page);
  const submit = await fillDelete(page, 'delete-account-refused', { code: '111111' });
  await submit.click();
  await expect(main(page).getByRole('alert')).toHaveText('That code didn’t work. Type the newest one from your app.');
  await expect(page).toHaveURL(/\/data\/delete$/);
  // The account is untouched: Your data still opens.
  await page.goto('/data');
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Your data');
  expect(violations).toEqual([]);
});

test('T-WSCR-12: an erase that fails keeps the person on the page, and Finish deleting completes it', async ({ page, context }) => {
  await signInAs(context, 'delete-account-retry');
  const violations = watchPolicy(page);
  const submit = await fillDelete(page, 'delete-account-retry');
  await submit.click();
  const unfinished = main(page).getByRole('alert');
  await expect(unfinished).toContainText('Your account isn’t deleted yet');
  await unfinished.getByRole('button', { name: 'Finish deleting' }).click();
  await expect(page).toHaveURL(/\/goodbye$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account is deleted');
  await expect(page.getByRole('main').getByRole('definition').nth(0)).toHaveText('584');
  expect(violations).toEqual([]);
});
