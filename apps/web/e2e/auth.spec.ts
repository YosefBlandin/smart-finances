import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { AUTHENTICATOR_CODE, EMAIL_CODE, newPerson, signIn, submit, setAddress, setLang, waitForFreshWindow, type Lang } from './helpers/signIn';

// T-WAUTH-17: on the fake sign-in service (STAGE=test: email code 123456, authenticator code 000000), sign-up to sign-out
// and a limit refusal work in both languages (AC-1, AC-12, AC-13, AC-17, AC-19, AC-20). Each test posts from its own
// address (X-Forwarded-For, whose right-most entry the server counts), so the auth posts per address (20 per 5 minutes,
// D-120) of one test never refuse another's. Every person is new: the STAGE=test server keeps its memory stores for the run.

const TEXT = {
  en: {
    signUp: 'Create your account',
    confirm: 'Check your email',
    confirmWrong: 'That code doesn’t match. Check the digits and try again.',
    resend: 'Send a new code',
    signIn: 'Sign in',
    setup: 'Set up your authenticator',
    setupWrong: 'That code didn’t work. Codes change every 30 seconds, so type the newest one.',
    consent: 'Your data, in plain words',
    signOut: 'Sign out',
    reset: 'Reset your password',
    resetConfirm: 'Choose a new password',
    passwordChanged: 'Your password was changed, and every session on every device was signed out. Sign in with your new password.',
    wrongPassword: 'That email and password don’t match. Check both and try again.',
    code: 'Enter your code',
    limited: /^Too many tries from this connection\. Try again in \d+ minutes\.$/,
  },
  es: {
    signUp: 'Crea tu cuenta',
    confirm: 'Revisa tu correo',
    confirmWrong: 'Ese código no coincide. Revisa los dígitos y vuelve a intentar.',
    resend: 'Enviar un código nuevo',
    signIn: 'Entrar',
    setup: 'Configura tu autenticador',
    setupWrong: 'Ese código no funcionó. Los códigos cambian cada 30 segundos; escribe el más reciente.',
    consent: 'Tus datos, en palabras simples',
    signOut: 'Cerrar sesión',
    reset: 'Restablece tu contraseña',
    resetConfirm: 'Elige una contraseña nueva',
    passwordChanged: 'Cambiamos tu contraseña y cerramos todas las sesiones en todos tus dispositivos. Entra con tu contraseña nueva.',
    wrongPassword: 'El correo y la contraseña no coinciden. Revisa ambos y vuelve a intentar.',
    code: 'Ingresa tu código',
    limited: /^Hubo demasiados intentos desde esta conexión\. Vuelve a intentar en \d+ minutos\.$/,
  },
} as const;

// style-src has no 'unsafe-inline' and script-src no 'unsafe-eval' (D-57, D-151): a page that breaks either logs it. No
// violation is allowed, including React Aria's pressable style after a server-action redirect (SF-155).
function watchPolicy(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    const text = m.text();
    if (/Content Security Policy/i.test(text)) violations.push(`${new URL(page.url()).pathname}: ${text}`);
  });
  return violations;
}

const heading = (page: Page) => page.getByRole('main').getByRole('heading', { level: 1 });
const form = (page: Page, field: string) => page.locator('form', { has: page.locator(`input[name="${field}"]`) });
// The form's refusal (the route announcer is an alert too, outside main).
const alert = (page: Page) => page.getByRole('main').getByRole('alert');

/** A browser that lost this one's cookies: the same language and address, nothing else. */
async function freshBrowser(context: BrowserContext, lang: Lang) {
  await context.clearCookies();
  await setLang(context, lang);
}

for (const lang of ['en', 'es'] as const) {
  const t = TEXT[lang];

  test(`T-WAUTH-17: sign-up, confirm, setup, consent, sign out, reset and a code sign-in in ${lang}`, async ({ page, context }) => {
    test.setTimeout(180_000);
    const violations = watchPolicy(page);
    await setAddress(context);
    await setLang(context, lang);
    const person = newPerson();

    // Sign up (AC-12, AC-14): the privacy notice and terms are accepted here, once (D-145).
    await page.goto('/sign-up');
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(heading(page)).toHaveText(t.signUp);
    const signUp = form(page, 'email');
    await signUp.locator('input[name="email"]').fill(person.email);
    await signUp.locator('input[name="password"]').fill(person.password);
    await signUp.locator('input[name="accept"]').check();
    await submit(signUp);

    // Confirm (D-147): a wrong code says so and offers a new one; the right one creates the account.
    await page.waitForURL('**/sign-up/confirm');
    await expect(heading(page)).toHaveText(t.confirm);
    await expect(page.getByRole('main')).toContainText(person.email);
    const confirm = form(page, 'code');
    await confirm.locator('input[name="code"]').fill('654321');
    await submit(confirm);
    await expect(alert(page)).toHaveText(t.confirmWrong);
    await expect(page.getByRole('button', { name: t.resend })).toBeVisible();
    await confirm.locator('input[name="code"]').fill(EMAIL_CODE);
    await submit(confirm);
    await page.waitForURL('**/sign-in');
    await expect(heading(page)).toHaveText(t.signIn);

    // Sign in from another browser, so the consent accepted at sign-up does not ride along: setup comes first (AC-13).
    await freshBrowser(context, lang);
    await page.goto('/sign-in');
    const password = form(page, 'password');
    await password.locator('input[name="email"]').fill(person.email);
    await password.locator('input[name="password"]').fill(person.password);
    await submit(password);
    await page.waitForURL('**/sign-in/setup');
    await expect(heading(page)).toHaveText(t.setup);
    await expect(page.getByRole('main').getByRole('img')).toBeVisible();
    const setup = form(page, 'code');
    await setup.locator('input[name="code"]').fill('111111');
    await submit(setup);
    await expect(alert(page)).toHaveText(t.setupWrong);
    await setup.locator('input[name="code"]').fill(AUTHENTICATOR_CODE);
    await submit(setup);

    // No consent at the current versions yet, so no money screen opens before it (D-87, D-145).
    await page.waitForURL('**/consent');
    await expect(heading(page)).toHaveText(t.consent);
    const consent = form(page, 'accept');
    await consent.locator('input[name="accept"]').check();
    await submit(consent);
    await page.waitForURL('**/overview');
    const account = page.locator('[data-account]').first();
    await expect(account).toBeVisible();

    // Sign out is a post (D-115); afterwards a money page sends the browser to sign-in.
    await account.getByRole('button', { name: t.signOut }).click();
    await page.waitForURL('**/sign-in');
    expect((await context.cookies()).map((c) => c.name)).not.toContain('__Host-sid');
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Foverview$/);

    // Reset (AC-20): a code to the email and a new password; every session ends and sign-in says so (D-92, D-122).
    await page.goto('/reset');
    await expect(heading(page)).toHaveText(t.reset);
    const forgot = form(page, 'email');
    await forgot.locator('input[name="email"]').fill(person.email);
    await submit(forgot);
    await page.waitForURL('**/reset/confirm');
    await expect(heading(page)).toHaveText(t.resetConfirm);
    const reset = form(page, 'password');
    await reset.locator('input[name="code"]').fill(EMAIL_CODE);
    await reset.locator('input[name="password"]').fill(person.newPassword);
    await submit(reset);
    await page.waitForURL('**/sign-in');
    await expect(page.getByRole('status').filter({ hasText: t.passwordChanged })).toBeVisible();

    // The old password no longer works; the new one still asks for the authenticator code (AC-20, AC-1).
    const again = form(page, 'password');
    await again.locator('input[name="email"]').fill(person.email);
    await again.locator('input[name="password"]').fill(person.password);
    await submit(again);
    await expect(alert(page)).toHaveText(t.wrongPassword);
    await again.locator('input[name="email"]').fill(person.email);
    await again.locator('input[name="password"]').fill(person.newPassword);
    await submit(again);
    await page.waitForURL('**/sign-in/code');
    await expect(heading(page)).toHaveText(t.code);
    const code = form(page, 'code');
    await code.locator('input[name="code"]').fill(AUTHENTICATOR_CODE);
    await submit(code);
    await page.waitForURL('**/overview');
    await expect(page.locator('[data-account]').first()).toBeVisible();

    expect(violations).toEqual([]);
  });
}

test('T-WAUTH-17: signing in from the browser that signed up records the consent given there and opens the overview', async ({ page, context }) => {
  test.setTimeout(120_000);
  const violations = watchPolicy(page);
  await signIn(page);
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.locator('[data-account]').first()).toBeVisible();
  // A reload keeps the person in (D-72).
  await page.reload();
  await expect(page).toHaveURL(/\/overview$/);
  expect((await context.cookies()).find((c) => c.name === '__Host-sid')).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  expect(violations).toEqual([]);
});

// The auth posts per address (AC-17, AC-19, D-120): the 21st post in a 5-minute window from one address is refused with a
// plain message, while another address is not slowed. English refuses sign-in posts, Spanish sign-up posts.
const REFUSALS = {
  en: { path: '/sign-in', field: 'password', done: (page: Page) => expect(alert(page)).toHaveText(TEXT.en.wrongPassword) },
  es: { path: '/sign-up', field: 'email', done: (page: Page) => page.waitForURL('**/sign-up/confirm') },
} as const;

async function post(page: Page, lang: Lang, n: number) {
  const { path, field } = REFUSALS[lang];
  if (path === '/sign-up' || new URL(page.url()).pathname !== path) await page.goto(path);
  const f = form(page, field);
  await f.locator('input[name="email"]').fill(`limit-${n}-${Date.now()}@example.test`);
  await f.locator('input[name="password"]').fill('a long enough test phrase');
  if (path === '/sign-up') await f.locator('input[name="accept"]').check();
  await submit(f);
}

for (const lang of ['en', 'es'] as const) {
  test(`T-WAUTH-17: the 21st auth post from one address in 5 minutes is refused in ${lang}, and another address is not`, async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(300_000);
    await setAddress(context);
    await setLang(context, lang);
    await waitForFreshWindow();

    for (let n = 1; n <= 20; n++) {
      await post(page, lang, n);
      await REFUSALS[lang].done(page);
    }
    await post(page, lang, 21);
    await expect(alert(page)).toHaveText(TEXT[lang].limited);
    expect(new URL(page.url()).pathname).toBe(REFUSALS[lang].path);

    // Another address posts as usual.
    const other = await browser.newContext();
    try {
      await setAddress(other);
      await setLang(other, lang);
      const otherPage = await other.newPage();
      await post(otherPage, lang, 22);
      await REFUSALS[lang].done(otherPage);
    } finally {
      await other.close();
    }
  });
}
