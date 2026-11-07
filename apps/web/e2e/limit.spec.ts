import { expect, test, type BrowserContext } from '@playwright/test';
import { waitForFreshWindow } from './helpers/signIn';

// The person limit (SF-172; AC-17, D-120): past 5 data requests a minute (120 on a real stage) a money page opens the
// limit page with the wait, and a JSON route answers 429 with Retry-After; another signed-in person is still served.
// Each test signs in as its own STAGE=test people (E2E_PEOPLE in src/adapters/container.ts).

test.use({ viewport: { width: 1280, height: 900 } });

async function signInAs(context: BrowserContext, person: string) {
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

const heading = (page: import('@playwright/test').Page) => page.getByRole('main').getByRole('heading', { level: 1 });

test('T-WSCR-17: past the person limit the limit page shows with the wait, and a second person is still served', async ({ browser }) => {
  test.setTimeout(90_000);
  // The counter counts in one-minute windows; start early in one so the six reads land in the same window.
  await waitForFreshWindow(60_000, 25_000);

  const first = await browser.newContext();
  await signInAs(first, 'limit-first');
  const page = await first.newPage();
  // To review makes one counted read per load (the shell's count and the list share it): five are served.
  for (let i = 0; i < 5; i++) {
    await page.goto('/review');
    await expect(heading(page)).toHaveText('To review');
  }
  // The sixth goes to the limit page, which says how long to wait.
  await page.goto('/review');
  await expect(page).toHaveURL(/\/too-many\?wait=\d+$/);
  const wait = Number(new URL(page.url()).searchParams.get('wait'));
  expect(wait).toBeGreaterThan(0);
  expect(wait).toBeLessThanOrEqual(60);
  await expect(heading(page)).toHaveText('Too many requests');
  await expect(page.getByRole('main')).toContainText(new RegExp(`Wait ${wait} seconds?, then try again\\.`));
  await expect(page.getByRole('main').getByRole('link', { name: 'Back to the overview' })).toHaveAttribute('href', '/overview');

  // A JSON read is refused the same way, with the wait in Retry-After.
  const json = await page.request.get('/api/data/review');
  expect(json.status()).toBe(429);
  expect(Number(json.headers()['retry-after'])).toBeGreaterThan(0);

  // Another person is not slowed.
  const second = await browser.newContext();
  await signInAs(second, 'limit-second');
  const other = await second.newPage();
  await other.goto('/review');
  await expect(heading(other)).toHaveText('To review');
  await expect(other.getByRole('main').getByRole('table')).toBeVisible();

  await first.close();
  await second.close();
});

test('T-WSCR-17: the limit page speaks Spanish and keeps a wait it cannot read to a minute', async ({ page, context }) => {
  await signInAs(context, 'limit-es');
  await context.addCookies([{ name: 'lang', value: 'es', url: 'http://localhost:3000/' }]);
  await page.goto('/too-many?wait=nonsense');
  await expect(heading(page)).toHaveText('Demasiadas solicitudes');
  await expect(page.getByRole('main')).toContainText('Espera 60 segundos y vuelve a intentar.');
});
