// next-intl without locale routing (D-126): the lang cookie picks the language, else Accept-Language (D-83).
// The URL never carries a language, so addresses stay the same in English and Spanish.
import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import type { Lang } from './format';

export const LOCALES: readonly Lang[] = ['en', 'es'];
export const LANG_COOKIE = 'lang';

const isLang = (value: string | undefined): value is Lang => value !== undefined && (LOCALES as readonly string[]).includes(value);

/** A valid cookie wins; otherwise the first Accept-Language entry decides (es, es-AR and so on mean Spanish); anything else is English. */
export function pickLocale(cookieValue: string | undefined, acceptLanguage: string | null | undefined): Lang {
  const fromCookie = cookieValue?.trim().toLowerCase();
  if (isLang(fromCookie)) return fromCookie;
  const first = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? '';
  return first === 'es' || first.startsWith('es-') ? 'es' : 'en';
}

export default getRequestConfig(async () => {
  const locale = pickLocale((await cookies()).get(LANG_COOKIE)?.value, (await headers()).get('accept-language'));
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
