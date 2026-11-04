// Custom message trigger of the sign-in pool (D-11, AC-4, AC-12, AC-20; architecture.md
// "Sign-in pool changes"). Sign-up, resent sign-up and password reset code emails go out in the
// person's language, which the web server passes as clientMetadata.lang ("en" or "es") on
// SignUp, ResendConfirmationCode and ForgotPassword. Anything that is not Spanish is English.
// Other messages (admin invite, attribute changes, sign-in codes) keep the pool's defaults.
// Nothing is logged: the event holds the person's email. No AWS client and no stage parameter.

export const MESSAGES = Object.freeze({
  en: Object.freeze({
    subject: 'Your Cuenta code',
    message: 'Your Cuenta code is {####}.',
  }),
  es: Object.freeze({
    subject: 'Tu código de Cuenta',
    message: 'Tu código de Cuenta es {####}.',
  }),
});

const CODE_SOURCES = new Set(['CustomMessage_SignUp', 'CustomMessage_ResendCode', 'CustomMessage_ForgotPassword']);
const PLACEHOLDER = '{####}';

/** "es", "ES", "es-ES" and "es-419" are Spanish; anything else, or nothing, is English. */
export function languageOf(clientMetadata) {
  const lang = clientMetadata?.lang;
  if (typeof lang !== 'string') return 'en';
  return lang.trim().toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
}

export async function handler(event) {
  if (!CODE_SOURCES.has(event?.triggerSource)) return event;
  const { subject, message } = MESSAGES[languageOf(event.request?.clientMetadata)];
  // Cognito replaces its own code placeholder; use the one it passes in case it ever differs.
  const code = event.request?.codeParameter || PLACEHOLDER;
  event.response = {
    ...event.response,
    emailSubject: subject,
    emailMessage: message.replace(PLACEHOLDER, code),
  };
  return event;
}
