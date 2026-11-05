import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// T-WAUTH-16: the privacy notice, the terms and the lost-authenticator page render in both languages (AC-14, D-103).
// Privacy and terms are read-only full text under one version id each, with no accept control (D-145); the privacy
// notice says a test stage's data may be wiped (D-118); the lost-authenticator page names the stage's support address
// (SUPPORT_ADDRESS, support@example.test under STAGE=test) and promises no reply time, only the 72-hour wait (D-148).

const VERSION = '2026-11-01';
const SUPPORT = 'support@example.test';

const SESSION = {
  name: '__Host-sid',
  value: 'e2e-dummy-session',
  url: 'https://localhost:3000/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax' as const,
};

// style-src has no 'unsafe-inline' (D-57), so a page that renders a style attribute logs a violation.
function watchStylePolicy(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text()) && /style-src/.test(m.text())) violations.push(m.text());
  });
  return violations;
}

async function useLang(context: BrowserContext, lang: 'en' | 'es') {
  await context.addCookies([{ name: 'lang', value: lang, url: 'http://localhost:3000/' }]);
}

const LEGAL = {
  privacy: {
    en: {
      title: 'Privacy notice',
      version: `Version ${VERSION}`,
      facts: ['us-east-1', '35 days', 'Pwned Passwords', 'Delete your account'],
      testStage: 'This is a test version',
      other: { name: 'Read the terms', href: '/terms' },
    },
    es: {
      title: 'Aviso de privacidad',
      version: `Versión ${VERSION}`,
      facts: ['us-east-1', '35 días', 'Pwned Passwords', 'Borra tu cuenta'],
      testStage: 'Esta es una versión de prueba',
      other: { name: 'Leer los términos', href: '/terms' },
    },
  },
  terms: {
    en: {
      title: 'Terms',
      version: `Version ${VERSION}`,
      facts: ['no investment or financial advice', 'never moves money', 'before any money screen opens'],
      testStage: 'This is a test version',
      other: { name: 'Read the privacy notice', href: '/privacy' },
    },
    es: {
      title: 'Términos',
      version: `Versión ${VERSION}`,
      facts: ['no da consejos de inversión ni financieros', 'nunca mueve plata', 'antes de abrir cualquier pantalla con plata'],
      testStage: 'Esta es una versión de prueba',
      other: { name: 'Leer el aviso de privacidad', href: '/privacy' },
    },
  },
} as const;

for (const path of ['privacy', 'terms'] as const) {
  for (const lang of ['en', 'es'] as const) {
    const want = LEGAL[path][lang];
    test(`T-WAUTH-16: /${path} renders the full text in ${lang} under one version id, read only`, async ({ page, context }) => {
      const violations = watchStylePolicy(page);
      await useLang(context, lang);
      const res = await page.goto(`/${path}`);
      expect(res?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      const main = page.getByRole('main');
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(main.getByRole('heading', { level: 1 })).toHaveText(want.title);

      // One version id, shown once.
      const version = main.locator('[data-version]');
      await expect(version).toHaveCount(1);
      await expect(version).toHaveAttribute('data-version', VERSION);
      await expect(version).toHaveText(want.version);
      expect((await main.innerText()).split(VERSION).length - 1).toBe(1);

      // Full text with sections, the facts the brief asks for, and the support address.
      expect(await main.getByRole('heading', { level: 2 }).count()).toBeGreaterThanOrEqual(4);
      for (const fact of want.facts) await expect(main).toContainText(fact);
      await expect(main).toContainText(SUPPORT);
      // STAGE=test is a test stage, like qa (D-118).
      await expect(main).toContainText(want.testStage);

      // Read only: no form, checkbox or button to accept (D-145).
      await expect(page.locator('form')).toHaveCount(0);
      await expect(page.getByRole('checkbox')).toHaveCount(0);
      await expect(page.getByRole('button')).toHaveCount(0);

      await expect(main.getByRole('link', { name: want.other.name })).toHaveAttribute('href', want.other.href);
      expect(violations).toEqual([]);
    });
  }
}

test('T-WAUTH-16: privacy and terms are open to anyone, signed in or not', async ({ page, context }) => {
  await context.addCookies([SESSION]);
  for (const path of ['/privacy', '/terms']) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(path);
  }
});

const LOST = {
  en: {
    title: 'Lost your authenticator?',
    wait: 'Once we confirm it’s you, we wait 72 hours before the reset, so nobody else can do it quickly.',
    proof: 'two or three things only you would know',
    back: 'Back to sign in',
    noReplyTime: /a day or two/i,
  },
  es: {
    title: '¿Perdiste tu autenticador?',
    wait: 'Cuando confirmamos que eres tú, esperamos 72 horas antes de restablecerlo, para que nadie más pueda hacerlo rápido.',
    proof: 'dos o tres cosas que solo tú sabes',
    back: 'Volver a entrar',
    noReplyTime: /uno o dos días/i,
  },
} as const;

for (const lang of ['en', 'es'] as const) {
  const want = LOST[lang];
  test(`T-WAUTH-16: /lost-authenticator in ${lang} names the support address and the 72-hour wait, no reply time`, async ({ page, context }) => {
    const violations = watchStylePolicy(page);
    await useLang(context, lang);
    const res = await page.goto('/lost-authenticator');
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    const main = page.getByRole('main');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(want.title);
    await expect(main).toContainText(SUPPORT);
    await expect(main.getByText(want.wait)).toBeVisible();
    await expect(main).toContainText(want.proof);
    expect(await main.innerText()).not.toMatch(want.noReplyTime);
    await expect(main.getByRole('link', { name: want.back })).toHaveAttribute('href', '/sign-in');
    await expect(page.locator('form')).toHaveCount(0);
    expect(violations).toEqual([]);
  });
}
