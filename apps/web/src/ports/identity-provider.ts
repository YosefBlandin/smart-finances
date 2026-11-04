import type { Result } from '@/domain/result';

export type Tokens = { access: string; id: string; refresh: string; expiresAt: number };
export type Lang = 'en' | 'es';
// refused: the pre-sign-up trigger said no (closed, disposable or another client); bad_password: the pool's policy.
export type IdentityFailure =
  | 'exists'
  | 'not_found'
  | 'unconfirmed'
  | 'bad_credentials'
  | 'bad_code'
  | 'expired_code'
  | 'bad_session'
  | 'bad_password'
  | 'refused'
  | 'revoked'
  | 'limited'
  | 'failed';
type R<T extends object = object> = Promise<Result<T, IdentityFailure>>;

// The Cognito username is the lower-cased email for sign-in calls and the sub for refresh and the admin calls
// that take a sub. clientMetadata.lang picks the language of the code emails (sign-up, resend, reset).
export interface IdentityProvider {
  signUp(email: string, password: string, lang: Lang): R;
  confirm(email: string, code: string): R;
  resend(email: string, lang: Lang): R;
  passwordAuth(email: string, password: string): R<{ tokens: Tokens } | { challenge: 'MFA_SETUP' | 'SOFTWARE_TOKEN_MFA'; session: string }>;
  associate(session: string): R<{ secret: string; session: string }>;
  /** Verifies the first code from the new key, then answers the MFA_SETUP challenge, which needs the username. */
  verifySetup(email: string, session: string, code: string): R<{ tokens: Tokens }>;
  respondCode(email: string, session: string, code: string): R<{ tokens: Tokens }>;
  forgot(email: string, lang: Lang): R;
  confirmForgot(email: string, code: string, password: string): R;
  refresh(sub: string, refreshToken: string): R<{ tokens: Tokens }>;
  revoke(refreshToken: string): R;
  adminGet(email: string): R<{ sub: string; status: string }>;
  adminDelete(sub: string): R;
  adminGlobalSignOut(sub: string): R;
}
