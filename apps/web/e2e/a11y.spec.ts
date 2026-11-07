import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import en from '../messages/en.json' with { type: 'json' };
import es from '../messages/es.json' with { type: 'json' };
import { AUTHENTICATOR_CODE, EMAIL_CODE, newPerson, setAddress, setLang, submit, type Lang } from './helpers/signIn';

// Accessibility (SF-171; AC-4, AC-10, D-22): axe finds no violation on any screen, in English and Spanish, light and
// dark (T-WSCR-15); the keyboard reaches every action of each money screen in order, with the focus visible, and a
// language switch made from the keyboard keeps the screen and its address (T-WSCR-16).
//
// axe-core runs inside the page through page.evaluate, which the content policy does not govern (a script tag would be
// refused). Money screens: each test signs in as its own STAGE=test person (E2E_PEOPLE in src/adapters/container.ts),
// since a person may make 5 data reads a minute under STAGE=test. Auth screens: a new person signs up and signs in.

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

type Theme = 'light' | 'dark';
const LANGS: Lang[] = ['en', 'es'];
const THEMES: Theme[] = ['light', 'dark'];
const SCREENS = {
  overview: '/overview',
  transactions: '/transactions?month=2026-05',
  review: '/review',
  imports: '/imports',
  rates: '/rates',
  data: '/data',
  delete: '/data/delete',
} as const;
type Screen = keyof typeof SCREENS;
/** Each screen's own heading, so a test never passes on the sign-in or session-ended screen. */
const TITLES = Object.fromEntries(
  (
    [
      ['en', en],
      ['es', es],
    ] as const
  ).map(([lang, m]) => [
    lang,
    {
      overview: m.nav.dashboard,
      transactions: m.nav.transactions,
      review: m.nav.review,
      imports: m.nav.imports,
      rates: m.rates.ratesTitle,
      data: m.nav.data,
      delete: m.auth.delete.warnTitle,
    } satisfies Record<Screen, string>,
  ]),
) as Record<Lang, Record<Screen, string>>;

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

type Violation = { id: string; impact: string | null; help: string; nodes: string[] };

/** Runs axe on the whole page and answers its violations, each with the first few offending selectors. */
async function axe(page: Page): Promise<Violation[]> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  return page.evaluate(async (source) => {
    const w = window as unknown as { axe?: { run: (ctx: Document, opts: object) => Promise<{ violations: unknown[] }> } };
    if (!w.axe) new Function(source)();
    const result = await w.axe!.run(document, { resultTypes: ['violations'] });
    return (result.violations as { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }[]).map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
  }, axeSource);
}

const heading = (page: Page) => page.getByRole('main').getByRole('heading', { level: 1 });

for (const lang of LANGS) {
  for (const theme of THEMES) {
    test.describe(`${lang}, ${theme}`, () => {
      test.beforeEach(async ({ page, context }) => {
        await setLang(context, lang);
        await page.emulateMedia({ colorScheme: theme });
      });

      for (const screen of Object.keys(SCREENS) as Screen[]) {
        test(`T-WSCR-15: axe finds no violation on ${screen} (${lang}, ${theme})`, async ({ page, context }) => {
          await signInAs(context, `a11y-${screen}-${lang}-${theme}`);
          await page.goto(SCREENS[screen]);
          await expect(heading(page)).toHaveText(TITLES[lang][screen]);
          await expect(page.locator('html')).toHaveAttribute('lang', lang);
          expect(await axe(page)).toEqual([]);
        });
      }

      test(`T-WSCR-15: axe finds no violation on the public and auth screens (${lang}, ${theme})`, async ({ page, context }) => {
        test.setTimeout(120_000);
        const person = newPerson();
        await setAddress(context);
        const form = (field: string) => page.locator('form', { has: page.locator(`input[name="${field}"]`) });
        const checked: Record<string, Violation[]> = {};
        const check = async (name: string) => {
          await expect(page.locator('html')).toHaveAttribute('lang', lang);
          await expect.poll(() => page.title(), { message: `${name} has a title` }).not.toBe('');
          checked[name] = await axe(page);
        };

        for (const path of ['/privacy', '/terms', '/lost-authenticator', '/goodbye']) {
          await page.goto(path);
          await check(path);
        }

        await page.goto('/sign-up');
        await check('/sign-up');
        const signUp = form('accept');
        await signUp.locator('input[name="email"]').fill(person.email);
        await signUp.locator('input[name="password"]').fill(person.password);
        await signUp.locator('input[name="accept"]').check();
        await submit(signUp);
        await page.waitForURL('**/sign-up/confirm');
        await check('/sign-up/confirm');
        await form('code').locator('input[name="code"]').fill(EMAIL_CODE);
        await submit(form('code'));
        await page.waitForURL('**/sign-in');
        await check('/sign-in');
        const password = form('password');
        await password.locator('input[name="email"]').fill(person.email);
        await password.locator('input[name="password"]').fill(person.password);
        await submit(password);
        await page.waitForURL('**/sign-in/setup');
        await check('/sign-in/setup');
        await form('code').locator('input[name="code"]').fill(AUTHENTICATOR_CODE);
        await submit(form('code'));
        await page.waitForURL('**/overview');

        // Signed out, the second sign-in asks for the authenticator code.
        await context.clearCookies({ name: '__Host-sid' });
        await page.goto('/sign-in');
        await password.locator('input[name="email"]').fill(person.email);
        await password.locator('input[name="password"]').fill(person.password);
        await submit(password);
        await page.waitForURL('**/sign-in/code');
        await check('/sign-in/code');

        await page.goto('/reset');
        await check('/reset');
        await form('email').locator('input[name="email"]').fill(person.email);
        await submit(form('email'));
        await page.waitForURL('**/reset/confirm');
        await check('/reset/confirm');

        expect(Object.fromEntries(Object.entries(checked).filter(([, v]) => v.length > 0))).toEqual({});
      });
    });
  }
}

type Stop = { idx: number; tag: string; name: string; visible: boolean };

/**
 * Numbers every element the keyboard should reach, in document order: enabled links, buttons and fields that are shown
 * and not hidden from assistive technology. Answers how many there are.
 */
async function markFocusable(page: Page): Promise<number> {
  return page.evaluate(() => {
    const selector =
      'a[href], button:not([disabled]), details > summary, input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const shown = (el: Element) => {
      if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false;
      // The content of a closed <details> is not rendered; only its summary is reached.
      const closed = el.closest('details:not([open])');
      if (closed && !(el.tagName === 'SUMMARY' && el.parentElement === closed)) return false;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      return el.getClientRects().length > 0;
    };
    const all = [...document.querySelectorAll(selector)].filter((el) => el.getAttribute('tabindex') !== '-1' && shown(el));
    all.forEach((el, i) => el.setAttribute('data-kbd', String(i)));
    return all.length;
  });
}

/** Where the focus is now, and whether a focus mark shows on it (an outline or a ring on it, or on the label around it). */
async function focused(page: Page): Promise<Stop | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const marked = (node: Element | null) => {
      if (!node) return false;
      const s = getComputedStyle(node);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      return outline || s.boxShadow !== 'none';
    };
    const label = el.closest('label');
    return {
      idx: Number(el.getAttribute('data-kbd') ?? -1),
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
      visible: marked(el) || marked(label) || marked(el.parentElement),
    };
  });
}

/** Tabs from the top of the page until the focus leaves it, and answers each stop. */
async function walk(page: Page, count: number): Promise<Stop[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops: Stop[] = [];
  for (let i = 0; i < count + 5; i++) {
    await page.keyboard.press('Tab');
    const stop = await focused(page);
    if (!stop) break;
    if (stops.length > 0 && stop.idx === stops[0]!.idx) break;
    stops.push(stop);
  }
  return stops;
}

for (const screen of Object.keys(SCREENS) as Screen[]) {
  test(`T-WSCR-16: the keyboard reaches every action on ${screen} in order, with the focus visible`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await signInAs(context, `a11y-keys-${screen}`);
    await page.goto(SCREENS[screen]);
    await expect(heading(page)).toHaveText(TITLES.en[screen]);
    await page.waitForLoadState('networkidle');
    const count = await markFocusable(page);
    expect(count).toBeGreaterThan(0);
    const stops = await walk(page, count);
    // Every action, once, in document order.
    const where = (s: Stop) => `${s.idx} ${s.tag} ${s.name}`;
    const marked = await page.evaluate(() =>
      [...document.querySelectorAll('[data-kbd]')].map((el) => `${el.getAttribute('data-kbd')} ${el.outerHTML.slice(0, 160)}`),
    );
    expect(
      stops.map((s) => s.idx),
      `reached:\n${stops.map(where).join('\n')}\nmarked:\n${marked.join('\n')}`,
    ).toEqual([...Array(count).keys()]);
    expect(stops.filter((s) => !s.visible)).toEqual([]);
  });
}

test('T-WSCR-16: a language switch made from the keyboard keeps the screen, its address and the session', async ({ page, context }) => {
  await signInAs(context, 'a11y-lang');
  const address = '/transactions?month=2026-05&kind=expense';
  await page.goto(address);
  await expect(heading(page)).toHaveText(en.nav.transactions);
  const before = page.url();

  // Tab to the language row in the account area and press Enter.
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim() === 'Español');
  }
  expect(reached).toBe(true);
  expect((await focused(page))?.visible).toBe(true);
  await page.keyboard.press('Enter');

  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(heading(page)).toHaveText(es.nav.transactions);
  expect(page.url()).toBe(before);
  await expect(page.getByRole('main').getByRole('table')).toBeVisible();
});
