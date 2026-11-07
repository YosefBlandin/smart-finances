import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

// Browser-test helpers for the auth flows on a STAGE=test server (D-151), whose fake sign-in service takes the email code
// 123456 and the authenticator code 000000 for everyone. signIn(page) signs a brand-new test person in, through the real
// sign-up, confirm, sign-in and setup screens, and leaves the page on the overview; PR 4's browser tests use it to get a
// signed-in person of their own. Synthetic data only: every address is @example.test.

export const EMAIL_CODE = '123456';
export const AUTHENTICATOR_CODE = '000000';
export type Lang = 'en' | 'es';
export type TestPerson = { email: string; password: string; newPassword: string };

const random = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A new synthetic person: a unique @example.test address and two passwords long enough for the rules (12+ characters). */
export function newPerson(): TestPerson {
  const id = random(6);
  return { email: `person-${id}@example.test`, password: `test phrase ${id} one`, newPassword: `test phrase ${id} two` };
}

/** The language cookie the language switch sets (D-11). */
export async function setLang(context: BrowserContext, lang: Lang) {
  await context.addCookies([{ name: 'lang', value: lang, url: 'http://localhost:3000/' }]);
}

/**
 * Gives this browser context an address of its own: the server counts auth posts per address prefix (IPv4 /24) from the
 * right-most X-Forwarded-For entry (D-120), and next start keeps a header the client sent. A random private /24 per
 * context keeps parallel tests from sharing the 20 posts per 5 minutes. Returns the address.
 */
export async function setAddress(context: BrowserContext): Promise<string> {
  const [a, b] = crypto.getRandomValues(new Uint8Array(2));
  const address = `10.${a}.${b}.7`;
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': address });
  return address;
}

/**
 * Submits a form that carries a proof-of-work answer (PowField): waits until the answer is solved, clicks the form's
 * submit button and waits for the server action's reply and for React to commit it. A redirect that follows is the
 * caller's to wait for.
 */
export async function submit(form: Locator) {
  await expect(form.locator('input[name="powSalt"]')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  // A busy button ignores presses (the previous post's reply may still be rendering), so wait for it to settle.
  const button = form.locator('button[type="submit"]');
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
  const page = form.page();
  const reply = page.waitForResponse((r) => r.request().method() === 'POST' && r.request().headers()['next-action'] !== undefined, {
    timeout: 60_000,
  });
  await button.click();
  await reply;
  // The reply arrives before React commits it. React resets an action's form, sets its new state and clears the busy
  // flag in that one commit, so wait for it: a field filled before it lands is wiped, and the next click then sends
  // nothing (the empty required field stops the post). A form that went away with a redirect passes at once.
  await expect(button.and(page.locator('[aria-busy="true"]'))).toHaveCount(0, { timeout: 60_000 });
}

/**
 * The counters count in fixed windows (start = floor(now / window) * window). When less than `needMs` is left in the
 * current window, waits for the next one, so a test that fills a window is not split by a window edge.
 */
export async function waitForFreshWindow(windowMs = 5 * 60_000, needMs = 100_000) {
  const left = windowMs - (Date.now() % windowMs);
  if (left < needMs) await new Promise((resolve) => setTimeout(resolve, left + 1_000));
}

const formWith = (page: Page, field: string) => page.locator('form', { has: page.locator(`input[name="${field}"]`) });

/**
 * Signs a new test person in and leaves the page on /overview: sign-up (accepting the privacy notice and the terms),
 * confirm with the email code, sign in, set up the authenticator. The consent given at sign-up is recorded at this first
 * sign-in, so no consent screen comes. Works in either language (fields are found by name). Gives the context its own
 * address (setAddress) unless `address: false`.
 */
export async function signIn(page: Page, opts: { person?: TestPerson; address?: boolean } = {}): Promise<TestPerson> {
  const person = opts.person ?? newPerson();
  if (opts.address !== false) await setAddress(page.context());

  await page.goto('/sign-up');
  const signUp = formWith(page, 'accept');
  await signUp.locator('input[name="email"]').fill(person.email);
  await signUp.locator('input[name="password"]').fill(person.password);
  await signUp.locator('input[name="accept"]').check();
  await submit(signUp);
  await page.waitForURL('**/sign-up/confirm');

  const confirm = formWith(page, 'code');
  await confirm.locator('input[name="code"]').fill(EMAIL_CODE);
  await submit(confirm);
  await page.waitForURL('**/sign-in');

  const password = formWith(page, 'password');
  await password.locator('input[name="email"]').fill(person.email);
  await password.locator('input[name="password"]').fill(person.password);
  await submit(password);
  await page.waitForURL('**/sign-in/setup');

  const setup = formWith(page, 'code');
  await setup.locator('input[name="code"]').fill(AUTHENTICATOR_CODE);
  await submit(setup);
  await page.waitForURL('**/overview');
  return person;
}
