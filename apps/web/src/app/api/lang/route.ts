import { NextResponse, type NextRequest } from 'next/server';
import { LANG_COOKIE, LOCALES } from '@/i18n/request';

// POST /api/lang (Contracts "Web routes"): sets the lang cookie and goes back to the address the person was on, so the
// screen and the session stay as they were (AC-4). The Origin must equal the stage's web address; a missing or null one
// is refused (Contracts "Cookies", D-115). Only en and es; the cookie is SameSite=Lax for one year.

const ONE_YEAR = 365 * 24 * 60 * 60;
const FALLBACK = '/overview';

// Until PR 3 settings are read from process.env, with a test default when STAGE=test (D-110).
function webOrigin(): string | undefined {
  if (process.env.WEB_ORIGIN) return process.env.WEB_ORIGIN;
  return process.env.STAGE === 'test' ? 'http://localhost:3000' : undefined;
}

// The same rule as the middleware's sign-in redirect: a path on this site with no dot segments, double slash,
// backslash, ? or # inside the path, or control character, checked as sent and decoded.
const UNSAFE_PATH = /(^|\/)\.\.?(\/|$)|\/\/|[\\?#]|[\u0000-\u001f\u007f]/;

function decoded(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function returnPath(next: FormDataEntryValue | null): string {
  if (typeof next !== 'string' || !next.startsWith('/')) return FALLBACK;
  const cut = next.indexOf('?');
  const path = cut === -1 ? next : next.slice(0, cut);
  const search = cut === -1 ? '' : next.slice(cut);
  const plain = decoded(path);
  if (plain === undefined || UNSAFE_PATH.test(path) || UNSAFE_PATH.test(plain) || /[#\\\u0000-\u001f\u007f]/.test(search)) return FALLBACK;
  return path + search;
}

const isLang = (value: FormDataEntryValue | null): value is (typeof LOCALES)[number] =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = webOrigin();
  if (!origin || req.headers.get('origin') !== origin)
    return NextResponse.json({ error: { code: 'forbidden', message: 'Forbidden' } }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'Bad request' } }, { status: 400 });
  }
  const lang = form.get('lang');
  if (!isLang(lang)) return NextResponse.json({ error: { code: 'bad_request', message: 'Bad request' } }, { status: 400 });

  const res = NextResponse.redirect(new URL(returnPath(form.get('next')), origin), 303);
  res.cookies.set(LANG_COOKIE, lang, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax', secure: origin.startsWith('https:') });
  return res;
}
