import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { formatAmount, formatPercent, formatPoints } from './format';
import { pickLocale } from './request';

const root = fileURLToPath(new URL('../..', import.meta.url));
const load = (locale: string): Record<string, unknown> => JSON.parse(readFileSync(path.join(root, 'messages', `${locale}.json`), 'utf8'));
const en = load('en');
const es = load('es');

function flatten(tree: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}
const flatEn = flatten(en);
const flatEs = flatten(es);

// Every {name, plural, ...} in a message: its argument name and the selectors it offers (=0, one, other ...).
function plurals(message: string): { arg: string; forms: string[] }[] {
  const found: { arg: string; forms: string[] }[] = [];
  const re = /\{(\w+),\s*plural,/g;
  for (let m = re.exec(message); m; m = re.exec(message)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const forms: string[] = [];
    let word = '';
    for (; i < message.length && depth > 0; i++) {
      const c = message[i];
      if (c === '{') {
        if (depth === 1 && word.trim()) forms.push(word.trim());
        word = '';
        depth++;
      } else if (c === '}') depth--;
      else if (depth === 1) word += c;
    }
    found.push({ arg: m[1]!, forms });
  }
  return found;
}

describe('T-WEB-5 catalogues', () => {
  it('T-WEB-5 en and es have exactly the same keys', () => {
    const onlyEn = Object.keys(flatEn).filter((k) => !(k in flatEs));
    const onlyEs = Object.keys(flatEs).filter((k) => !(k in flatEn));
    expect({ onlyEn, onlyEs }).toEqual({ onlyEn: [], onlyEs: [] });
    expect(Object.keys(flatEn).length).toBeGreaterThan(250);
  });

  it('T-WEB-5 no message is empty', () => {
    for (const [lang, flat] of [
      ['en', flatEn],
      ['es', flatEs],
    ] as const) {
      for (const [k, v] of Object.entries(flat)) expect(v.trim().length, `${lang}:${k}`).toBeGreaterThan(0);
    }
  });

  it('T-WEB-5 every plural has the same argument and the same forms in both languages, with one and other', () => {
    let count = 0;
    for (const key of Object.keys(flatEn)) {
      const a = plurals(flatEn[key]!);
      const b = plurals(flatEs[key]!);
      expect(
        b.map((p) => p.arg),
        key,
      ).toEqual(a.map((p) => p.arg));
      a.forEach((p, i) => {
        expect([...b[i]!.forms].sort(), key).toEqual([...p.forms].sort());
        expect(p.forms, key).toContain('other');
        expect(p.forms, key).toContain('one');
        count++;
      });
    }
    expect(count).toBe(7);
  });

  it('T-WEB-5 the counts that can be zero have a zero form (D-19)', () => {
    for (const key of ['overview.todoReview', 'overview.todoImports']) {
      expect(plurals(flatEn[key]!)[0]!.forms, key).toContain('=0');
      expect(plurals(flatEs[key]!)[0]!.forms, key).toContain('=0');
    }
  });

  it.each(['en', 'es'] as const)('T-WEB-5 every %s message is valid ICU and formats with sample values', (locale) => {
    const messages = locale === 'en' ? en : es;
    const flat = locale === 'en' ? flatEn : flatEs;
    const t = createTranslator({
      locale,
      messages: messages as never,
      onError: (e) => {
        throw e;
      },
    });
    for (const [key, message] of Object.entries(flat)) {
      const args: Record<string, unknown> = {};
      const plural = new Set(plurals(message).map((p) => p.arg));
      for (const m of message.matchAll(/\{(\w+)[,}]/g)) args[m[1]!] = plural.has(m[1]!) ? 1 : 'x';
      for (const tag of message.matchAll(/<(\w+)>/g)) args[tag[1]!] = (chunks: unknown) => chunks;
      expect(() => (t as unknown as { rich: (k: string, v: unknown) => unknown }).rich(key, args), `${locale}:${key}`).not.toThrow();
    }
  });

  it('T-WEB-5 keeps the sign-in footer words exactly (SF-101 copy)', () => {
    expect(flatEn['auth.common.footer']).toBe('Sign out when you’re done; the session also ends after 30 idle minutes.');
    expect(flatEs['auth.common.footer']).toContain('30 minutos');
  });

  it('T-WEB-5 has no temporary-password screen copy', () => {
    for (const v of [...Object.values(flatEn), ...Object.values(flatEs)]) expect(v).not.toMatch(/temporary password|contraseña temporal/i);
  });
});

describe('T-WEB-6 language choice (D-83)', () => {
  it.each([
    ['es', undefined, 'es'],
    ['en', 'es-AR,es;q=0.9', 'en'],
    ['es', 'en-US,en;q=0.9', 'es'],
    [undefined, 'es-AR,es;q=0.9,en;q=0.8', 'es'],
    [undefined, 'es', 'es'],
    [undefined, 'ES-ar', 'es'],
    [undefined, 'en-US,en;q=0.9', 'en'],
    [undefined, 'fr-FR,fr;q=0.9', 'en'],
    [undefined, undefined, 'en'],
    [undefined, null, 'en'],
    ['fr', 'es-AR', 'es'],
    ['', 'es', 'es'],
    ['ES', undefined, 'es'],
  ])('T-WEB-6 cookie %j, Accept-Language %j gives %s', (cookie, header, expected) => {
    expect(pickLocale(cookie, header)).toBe(expected);
  });
});

describe('T-WEB-6 amounts (D-23, D-30)', () => {
  const plain = (s: string) => s.replace(/ | /g, ' ');

  it('T-WEB-6 summaries show pesos as whole numbers and dollars with cents', () => {
    expect(plain(formatAmount(180486600, 'ARS', { locale: 'en', summary: true }))).toBe('ARS 1,804,866');
    expect(plain(formatAmount(180486600, 'ARS', { locale: 'es', summary: true }))).toBe('ARS 1.804.866');
    expect(plain(formatAmount(4598, 'USD', { locale: 'en', summary: true }))).toBe('USD 45.98');
    expect(plain(formatAmount(4598, 'USD', { locale: 'es', summary: true }))).toBe('USD 45,98');
    expect(plain(formatAmount(150050, 'ARS', { locale: 'en', summary: true }))).toBe('ARS 1,501');
    expect(plain(formatAmount(-21242500, 'ARS', { locale: 'en', summary: true }))).toBe('−ARS 212,425');
  });

  it('T-WEB-6 lists of single transactions keep exact cents in both currencies', () => {
    expect(plain(formatAmount(-1250000, 'ARS', { locale: 'en' }))).toBe('−ARS 12,500.00');
    expect(plain(formatAmount(-1250050, 'ARS', { locale: 'es' }))).toBe('−ARS 12.500,50');
    expect(plain(formatAmount(195000, 'USD', { locale: 'en', signed: true }))).toBe('+USD 1,950.00');
    expect(plain(formatAmount(-1599, 'USD', { locale: 'en' }))).toBe('−USD 15.99');
    expect(plain(formatAmount(0, 'USD', { locale: 'en', signed: true }))).toBe('USD 0.00');
  });

  it('T-WEB-6 percentages in the colour field are whole numbers; the comparison keeps exact points', () => {
    expect(plain(formatPercent(0.317, 'en'))).toBe('32%');
    expect(plain(formatPercent(0.317, 'es'))).toMatch(/^32 ?%$/);
    expect(plain(formatPercent(-0.034, 'en'))).toBe('−3%');
    expect(plain(formatPoints(0.317, 'en'))).toBe('31.7%');
    expect(plain(formatPoints(0.317, 'es'))).toMatch(/^31,7 ?%$/);
    expect(plain(formatPoints(-0.0125, 'en'))).toBe('−1.3%');
  });
});
