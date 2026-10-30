import { expect, test, type Page } from '@playwright/test';

// The shell: rail on desktop (D-35 to D-42), top bar with a menu panel under 960px (D-24, D-43, D-44), the language row
// (D-37, AC-4) and focus on the main heading after navigation (AC-10). A dummy __Host-sid passes the middleware's
// cookie-presence check; the session itself is checked from PR 3 on.

const ORIGIN = 'http://localhost:3000';

test.beforeEach(async ({ context }) => {
  // Chrome counts localhost as secure, so a Secure cookie set for the https form of the address is sent over http too.
  await context.addCookies([
    { name: '__Host-sid', value: 'e2e-dummy-session', url: 'https://localhost:3000/', secure: true, httpOnly: true, sameSite: 'Lax' },
  ]);
});

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
const MONEY = ['Overview', 'Transactions', 'To review', 'Imports', 'Dollar rates'];

test.describe('desktop rail', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('T-WEB-10: the rail lists Money and Account, marks the current screen with a 2px ink line, and has no Ask or Prototype group', async ({
    page,
  }) => {
    const violations = watchPolicy(page);
    await page.goto('/overview');
    const nav = rail(page);
    await expect(nav).toBeVisible();
    const links = nav.getByRole('link');
    await expect(links).toHaveText([...MONEY, 'Your data']);
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

  test('T-WEB-10: the account area names who is signed in, then the language row and Sign out as plain rows', async ({ page }) => {
    const violations = watchPolicy(page);
    await page.goto('/overview');
    const account = page.locator('[data-account]').first();
    await expect(account).toBeVisible();
    await expect(account).toContainText('you@example.com');
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

  test('T-WEB-10: the rail and its account area stay in view while the page scrolls', async ({ page }) => {
    await page.goto('/transactions');
    // A tall page, built through the DOM (the policy allows CSSOM styles, not style attributes).
    await page.evaluate(() => {
      const tall = document.createElement('div');
      tall.style.height = '4000px';
      document.querySelector('main')!.append(tall);
      window.scrollTo(0, document.body.scrollHeight);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const signOut = page.locator('[data-account]').first().getByRole('button', { name: 'Sign out' });
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await expect(rail(page).getByRole('link', { name: 'Overview' })).toBeInViewport({ ratio: 1 });
  });

  test('T-WEB-10: after a navigation focus moves to the main heading and the mark follows', async ({ page }) => {
    const violations = watchPolicy(page);
    await page.goto('/overview');
    await rail(page).getByRole('link', { name: 'Transactions' }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveText('Transactions');
    await expect(h1).toBeFocused();
    await expect(rail(page).getByRole('link', { name: 'Transactions' })).toHaveAttribute('aria-current', 'page');
    await expect(rail(page).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');

    // Keyboard only (AC-10): Enter on a focused rail link.
    await rail(page).getByRole('link', { name: 'Dollar rates' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/rates$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dollar rates');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    expect(violations).toEqual([]);
  });

  test('T-WEB-10: every money screen renders in the shell with one h1 and no policy violation', async ({ page }) => {
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

  test('T-WEB-10: the rail folds into a bar with the brand and a 44px menu button naming the screen', async ({ page }) => {
    const violations = watchPolicy(page);
    await page.goto('/imports');
    await expect(rail(page)).toBeHidden();
    const button = page.getByRole('button', { name: /Imports/ });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBe(44);
    await expect(button.locator('[data-icon="menu"]')).toHaveCount(1);
    // D-44: no count when nothing waits for review (the count comes with the review data in PR 4).
    await expect(button.locator('[data-count]')).toHaveCount(0);
    // D-24: nothing but the bar sits above the screen's heading, so it shows in the first screen.
    const h1 = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect(h1.y).toBeLessThan(200);
    expect(violations).toEqual([]);
  });

  test('T-WEB-10: the menu opens as a panel under the bar without moving the page, and a chosen link closes it', async ({ page }) => {
    const violations = watchPolicy(page);
    await page.goto('/overview');
    const button = page.getByRole('button', { name: /Overview/ });
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
    await expect(panel.getByRole('link')).toHaveText([...MONEY, 'Your data']);
    await expect(panel.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    await expect(panel).toContainText('you@example.com');
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
    const violations = watchPolicy(page);
    await page.goto('/transactions?month=2026-05&view=usd');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('[data-account]').first().getByRole('button', { name: 'Español' }).click();
    await expect(page).toHaveURL(/\/transactions\?month=2026-05&view=usd$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('navigation', { name: 'Pantallas' }).getByRole('link', { name: 'Movimientos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('navigation', { name: 'Pantallas' }).getByRole('link', { name: 'Cotizaciones' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Movimientos');
    const lang = (await context.cookies()).find((c) => c.name === 'lang');
    expect(lang?.value).toBe('es');
    expect(lang?.sameSite).toBe('Lax');
    expect(lang!.expires - Date.now() / 1000).toBeGreaterThan(364 * 24 * 3600);
    // Still signed in: the session cookie is untouched.
    expect((await context.cookies()).some((c) => c.name === '__Host-sid')).toBe(true);

    await page.locator('[data-account]').first().getByRole('button', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/transactions\?month=2026-05&view=usd$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transactions');
    expect(violations).toEqual([]);
  });

  test('T-WEB-11: the menu panel switches language too, on a tablet', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto('/rates');
    await page.getByRole('button', { name: /Dollar rates/ }).click();
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Español' }).click();
    await expect(page).toHaveURL(/\/rates$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cotización del dólar');
    await expect(page.getByRole('button', { name: /Cotizaciones/ })).toBeVisible();
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
