import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// The shell: rail on desktop (D-35 to D-42), top bar with a menu panel under 960px (D-24, D-43, D-44), the language row
// (D-37, AC-4) and focus on the main heading after navigation (AC-10). The money layout checks the session and consent
// (D-108, SF-150), so each test opens the screens with the __Host-sid of its own STAGE=test person (E2E_PEOPLE in
// src/adapters/container.ts: a live session with the current consent in the test server's memory stores). Own people,
// because a person may make 5 data reads a minute under STAGE=test and one overview first view makes 5 (SF-164, D-157).

const ORIGIN = 'http://localhost:3000';

type Person =
  | 'shell-rail'
  | 'shell-account'
  | 'shell-scroll'
  | 'shell-focus'
  | 'shell-screens-overview'
  | 'shell-screens-transactions'
  | 'shell-screens-review'
  | 'shell-screens-imports'
  | 'shell-screens-rates'
  | 'shell-screens-data'
  | 'shell-topbar'
  | 'shell-menu'
  | 'shell-lang'
  | 'shell-lang-refused'
  | 'shell-lang-tablet';

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

const rail = (page: Page) => page.getByRole('navigation', { name: 'Screens' });
// The To review link also carries the count of rows to review once there are any (D-44; 72 in the fixtures).
const MONEY_LINKS = ['Overview', 'Transactions', /^To review/, 'Imports', 'Dollar rates', 'Your data'];

test.describe('desktop rail', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('T-WEB-10: the rail lists Money and Account, marks the current screen with a 2px ink line, and has no Ask or Prototype group', async ({
    page,
    context,
  }) => {
    await signInAs(context, 'shell-rail');
    const violations = watchPolicy(page);
    await page.goto('/overview');
    const nav = rail(page);
    await expect(nav).toBeVisible();
    const links = nav.getByRole('link');
    await expect(links).toHaveText(MONEY_LINKS);
    await expect(nav.getByText('Money', { exact: true })).toBeVisible();
    await expect(nav.getByText('Account', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ask' })).toHaveCount(0);
    await expect(page.getByText('Prototype')).toHaveCount(0);

    const current = nav.getByRole('link', { name: 'Overview' });
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
    const mark = await current.evaluate((el) => {
      const own = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      return {
        weight: own.fontWeight,
        color: own.color,
        fill: own.backgroundColor,
        shadow: own.boxShadow,
        width: before.width,
        line: before.backgroundColor,
      };
    });
    // D-39: a 2px ink line beside a bold ink label, no fill and no shadow.
    expect(mark).toEqual({ weight: '700', color: mark.line, fill: 'rgba(0, 0, 0, 0)', shadow: 'none', width: '2px', line: mark.color });
    const other = await nav.getByRole('link', { name: 'Imports' }).evaluate((el) => getComputedStyle(el, '::before').content);
    expect(['none', 'normal']).toContain(other);

    // D-40: the wordmark at 700; the stage tag is a 12px uppercase label in Chivo, not Chivo Mono.
    const brand = await page.locator('[data-brand]').evaluate((el) => getComputedStyle(el).fontWeight);
    expect(brand).toBe('700');
    const tag = await page.locator('[data-stage-tag]').evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, transform: s.textTransform, family: s.fontFamily };
    });
    expect(tag.size).toBe('12px');
    expect(tag.transform).toBe('uppercase');
    expect(tag.family).not.toMatch(/mono/i);

    // D-41: a group label sits 24px below the group above and 8px above its first link.
    const gaps = await nav.evaluate((el) => {
      const label = el.querySelector('[data-group="account"]') as HTMLElement;
      const s = getComputedStyle(label);
      const box = label.getBoundingClientRect();
      const top = box.top + parseFloat(s.paddingTop);
      const bottom = box.bottom - parseFloat(s.paddingBottom);
      const above = [...el.querySelectorAll('a')].find((a) => a.textContent?.includes('Dollar rates'))!.getBoundingClientRect();
      const below = [...el.querySelectorAll('a')].find((a) => a.textContent?.includes('Your data'))!.getBoundingClientRect();
      return { above: Math.round(top - above.bottom), below: Math.round(below.top - bottom) };
    });
    expect(gaps).toEqual({ above: 24, below: 8 });

    await expect(page.getByRole('button', { name: /Overview/ })).toBeHidden();
    expect(violations).toEqual([]);
  });

  test('T-WEB-10: the account area names who is signed in, then the language row and Sign out as plain rows', async ({ page, context }) => {
    await signInAs(context, 'shell-account');
    const violations = watchPolicy(page);
    await page.goto('/overview');
    const account = page.locator('[data-account]').first();
    await expect(account).toBeVisible();
    await expect(account).toContainText('shell-account@example.com');
    await expect(account).toContainText('Authenticator on');
    const lang = account.getByRole('button', { name: 'Español' });
    await expect(lang).toHaveAttribute('lang', 'es');
    await expect(lang.locator('svg')).toHaveCount(1);
    const signOut = account.getByRole('button', { name: 'Sign out' });
    await expect(signOut).toBeVisible();
    for (const row of [lang, signOut]) {
      expect(await row.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('none');
    }
    // D-38: muted small text under the address.
    const mfa = await account.getByText('Authenticator on').evaluate((el) => getComputedStyle(el).fontSize);
    expect(mfa).toBe('12px');
    expect(violations).toEqual([]);
  });

  test('T-WEB-10: the rail and its account area stay in view while the page scrolls', async ({ page, context }) => {
    await signInAs(context, 'shell-scroll');
    await page.goto('/transactions');
    // A tall page, built through the DOM (the policy allows CSSOM styles, not style attributes). Hydration removes a
    // node it did not render, so one added before hydration ends is added again until it stays and the page scrolls.
    await expect
      .poll(() =>
        page.evaluate(() => {
          if (!document.querySelector('main [data-tall]')) {
            const tall = document.createElement('div');
            tall.dataset.tall = '';
            tall.style.height = '4000px';
            document.querySelector('main')!.append(tall);
          }
          window.scrollTo(0, document.body.scrollHeight);
          return window.scrollY;
        }),
      )
      .toBeGreaterThan(1000);
    const signOut = page.locator('[data-account]').first().getByRole('button', { name: 'Sign out' });
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await expect(rail(page).getByRole('link', { name: 'Overview' })).toBeInViewport({ ratio: 1 });
  });

  test('T-WEB-10: after a navigation focus moves to the main heading and the mark follows', async ({ page, context }) => {
    await signInAs(context, 'shell-focus');
    const violations = watchPolicy(page);
    // Starts on Imports, which reads no data yet: the overview's 5 reads plus the transactions read would pass the
    // STAGE=test person's 5 a minute (D-157).
    await page.goto('/imports');
    await rail(page).getByRole('link', { name: 'Transactions' }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveText('Transactions');
    await expect(h1).toBeFocused();
    await expect(rail(page).getByRole('link', { name: 'Transactions' })).toHaveAttribute('aria-current', 'page');
    await expect(rail(page).getByRole('link', { name: 'Imports' })).not.toHaveAttribute('aria-current');

    // Keyboard only (AC-10): Enter on a focused rail link.
    await rail(page).getByRole('link', { name: 'Dollar rates' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/rates$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dollar rates');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    expect(violations).toEqual([]);
  });

  test('T-WEB-10: every money screen renders in the shell with one h1 and no policy violation', async ({ page, context }) => {
    const violations = watchPolicy(page);
    const titles: Record<string, string> = {
      overview: 'Overview',
      transactions: 'Transactions',
      review: 'To review',
      imports: 'Imports',
      rates: 'Dollar rates',
      data: 'Your data',
    };
    for (const [path, title] of Object.entries(titles)) {
      // Each screen has a person of its own: the overview's first view makes all 5 of a STAGE=test person's data reads a
      // minute, and every screen now reads the rows to review for the shell's count as well as its own data (SF-166).
      await signInAs(context, `shell-screens-${path}` as Person);
      await page.goto(`/${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(rail(page).getByRole('link', { name: title })).toHaveAttribute('aria-current', 'page');
    }
    expect(violations).toEqual([]);
  });
});

test.describe('top bar under 960px', () => {
  test.use({ viewport: { width: 900, height: 800 } });

  test('T-WEB-10: the rail folds into a bar with the brand and a 44px menu button naming the screen', async ({ page, context }) => {
    await signInAs(context, 'shell-topbar');
    const violations = watchPolicy(page);
    await page.goto('/imports');
    await expect(rail(page)).toBeHidden();
    const button = page.getByRole('button', { name: /Imports/ });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBe(44);
    await expect(button.locator('[data-icon="menu"]')).toHaveCount(1);
    // D-44: the count of rows to review rides on the menu button, from every screen (72 in the fixtures).
    await expect(button.locator('[data-count]')).toHaveText('7272 to review');
    // D-24: nothing but the bar sits above the screen's heading, so it shows in the first screen.
    const h1 = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect(h1.y).toBeLessThan(200);
    expect(violations).toEqual([]);
  });

  test('T-WEB-10: the menu opens as a panel under the bar without moving the page, and a chosen link closes it', async ({ page, context }) => {
    await signInAs(context, 'shell-menu');
    const violations = watchPolicy(page);
    // Starts on Transactions: the overview's 5 reads plus the review screen's read would pass the STAGE=test person's
    // 5 a minute (SF-166, D-157).
    await page.goto('/transactions');
    const button = page.getByRole('button', { name: /Transactions/ });
    const before = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    const bar = (await page.locator('[data-topbar]').boundingBox())!;
    await button.click();
    const panel = page.getByRole('dialog', { name: 'Menu' });
    await expect(panel).toBeVisible();
    await expect(button.locator('[data-icon="close"]')).toHaveCount(1);
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(bar.y + bar.height - 2);
    const after = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect(after.y).toBe(before.y);

    // The same links and account rows as the rail.
    await expect(panel.getByRole('link')).toHaveText(MONEY_LINKS);
    await expect(panel.getByRole('link', { name: 'Transactions' })).toHaveAttribute('aria-current', 'page');
    await expect(panel).toContainText('shell-menu@example.com');
    await expect(panel.getByRole('button', { name: 'Español' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await panel.getByRole('link', { name: 'To review' }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(panel).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('To review');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.getByRole('button', { name: /To review/ })).toBeVisible();

    // Escape closes it and gives focus back to the button.
    await page.getByRole('button', { name: /To review/ }).click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: /To review/ })).toBeFocused();
    expect(violations).toEqual([]);
  });
});

test.describe('language', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('T-WEB-11: switching language keeps the address and sets html lang', async ({ page, context }) => {
    await signInAs(context, 'shell-lang');
    const violations = watchPolicy(page);
    // On To review: one data read per render (the shell's count and the list share it), so the three renders stay within
    // the STAGE=test person's 5 reads a minute (SF-166, D-157).
    await page.goto('/review?month=2026-05&view=usd');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('[data-account]').first().getByRole('button', { name: 'Español' }).click();
    await expect(page).toHaveURL(/\/review\?month=2026-05&view=usd$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('navigation', { name: 'Pantallas' }).getByRole('link', { name: /^Por revisar/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('navigation', { name: 'Pantallas' }).getByRole('link', { name: 'Cotizaciones' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Por revisar');
    const lang = (await context.cookies()).find((c) => c.name === 'lang');
    expect(lang?.value).toBe('es');
    expect(lang?.sameSite).toBe('Lax');
    expect(lang!.expires - Date.now() / 1000).toBeGreaterThan(364 * 24 * 3600);
    // Still signed in: the session cookie is untouched.
    expect((await context.cookies()).some((c) => c.name === '__Host-sid')).toBe(true);

    await page.locator('[data-account]').first().getByRole('button', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/review\?month=2026-05&view=usd$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('To review');
    expect(violations).toEqual([]);
  });

  test('T-WEB-11: a refused or failed language switch says so and keeps the page as it was', async ({ page, context }) => {
    await signInAs(context, 'shell-lang-refused');
    await page.goto('/transactions?month=2026-05');
    await page.route('**/api/lang', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }));
    await page.locator('[data-account]').first().getByRole('button', { name: 'Español' }).click();
    await expect(page.locator('[data-account]').first().getByRole('alert')).toHaveText('The language didn’t change. Try again.');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveURL(/\/transactions\?month=2026-05$/);

    await page.unroute('**/api/lang');
    await page.route('**/api/lang', (route) => route.abort('failed'));
    await page.locator('[data-account]').first().getByRole('button', { name: 'Español' }).click();
    await expect(page.locator('[data-account]').first().getByRole('alert')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('T-WEB-11: the menu panel switches language too, on a tablet', async ({ page, context }) => {
    await signInAs(context, 'shell-lang-tablet');
    await page.setViewportSize({ width: 800, height: 900 });
    // On To review, for the same reason as above (SF-166, D-157).
    await page.goto('/review');
    await page.getByRole('button', { name: /To review/ }).click();
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Español' }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Por revisar');
    await expect(page.getByRole('button', { name: /Por revisar/ })).toBeVisible();
  });
});

test.describe('/api/lang', () => {
  const post = (request: import('@playwright/test').APIRequestContext, form: Record<string, string>, headers: Record<string, string> = {}) =>
    request.post('/api/lang', { form, headers, maxRedirects: 0 });

  test('T-WEB-11: a post from the web origin sets the lang cookie and goes back to the same address', async ({ request }) => {
    const res = await post(request, { lang: 'es', next: '/transactions?month=2026-05' }, { origin: ORIGIN });
    expect(res.status()).toBe(303);
    expect(new URL(res.headers()['location'] ?? '', ORIGIN).pathname + new URL(res.headers()['location'] ?? '', ORIGIN).search).toBe(
      '/transactions?month=2026-05',
    );
    const cookie = res.headers()['set-cookie'] ?? '';
    expect(cookie).toMatch(/^lang=es;/);
    expect(cookie).toMatch(/Max-Age=31536000/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  test('T-WEB-11: a missing, null or foreign Origin is refused with 403 and no cookie', async ({ request }) => {
    for (const headers of [
      {} as Record<string, string>,
      { origin: 'null' },
      { origin: 'https://evil.example' },
      { origin: 'http://localhost:3001' },
    ]) {
      const res = await post(request, { lang: 'es', next: '/overview' }, headers);
      expect(res.status(), JSON.stringify(headers)).toBe(403);
      expect(res.headers()['set-cookie']).toBeUndefined();
    }
  });

  test('T-WEB-11: only en and es are accepted, and next must be a path on this site', async ({ request }) => {
    for (const lang of ['fr', '', 'es;', 'EN ']) {
      const res = await post(request, { lang, next: '/overview' }, { origin: ORIGIN });
      expect(res.status(), lang).toBe(400);
      expect(res.headers()['set-cookie']).toBeUndefined();
    }
    for (const next of ['//evil.example/x', 'https://evil.example/', '/\\evil.example', 'overview', '', '/%2F%2Fevil.example']) {
      const res = await post(request, { lang: 'en', next }, { origin: ORIGIN });
      expect(res.status(), next).toBe(303);
      expect(res.headers()['location'], next).toMatch(/^(http:\/\/localhost:3000)?\/overview$/);
    }
    expect((await request.get('/api/lang', { maxRedirects: 0 })).status()).toBe(405);
  });
});
