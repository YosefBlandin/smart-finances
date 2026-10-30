import type { Result } from '@/domain/result';

export type Tokens = { access: string; id: string; refresh: string; expiresAt: number };
export type Lang = 'en' | 'es';
export type IdentityFailure =
  'exists' | 'not_found' | 'unconfirmed' | 'bad_credentials' | 'bad_code' | 'expired_code' | 'bad_session' | 'revoked' | 'limited' | 'failed';
type R<T extends object = object> = Promise<Result<T, IdentityFailure>>;

// The Cognito username is the email for sign-in calls and the sub for refresh.
export interface IdentityProvider {
  signUp(email: string, password: string, lang: Lang): R;
  confirm(email: string, code: string): R;
  resend(email: string, lang: Lang): R;
  passwordAuth(email: string, password: string): R<{ tokens: Tokens } | { challenge: 'MFA_SETUP' | 'SOFTWARE_TOKEN_MFA'; session: string }>;
  associate(session: string): R<{ secret: string; session: string }>;
  verifySetup(session: string, code: string): R;
  respondCode(email: string, session: string, code: string): R<{ tokens: Tokens }>;
  forgot(email: string, lang: Lang): R;
  confirmForgot(email: string, code: string, password: string): R;
  refresh(sub: string, refreshToken: string): R<{ tokens: Tokens }>;
  revoke(refreshToken: string): R;
  adminGet(email: string): R<{ sub: string; status: string }>;
  adminDelete(sub: string): R;
  adminGlobalSignOut(sub: string): R;
}
