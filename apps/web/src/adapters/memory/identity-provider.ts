import type { Clock } from '@/ports/clock';
import type { IdentityFailure, IdentityProvider, Lang, Tokens } from '@/ports/identity-provider';

// The test identity fake: every email code is 123456 and every authenticator code is 000000 (PR 3 relies on these).
// Like the Cognito adapter it lower-cases the email; subs are deterministic (the nth sign-up of a fake gets the same
// sub every run); codeEmails records each code email the pool would send, with its language.
export const TEST_EMAIL_CODE = '123456';
export const TEST_AUTHENTICATOR_CODE = '000000';
const HOUR = 3_600_000;

type User = { sub: string; email: string; password: string; status: 'UNCONFIRMED' | 'CONFIRMED'; authenticator: boolean; resetPending: boolean };
type Challenge = { email: string; step: 'MFA_SETUP' | 'MFA_SETUP_ASSOCIATED' | 'SOFTWARE_TOKEN_MFA' };

const fail = (reason: IdentityFailure) => ({ ok: false as const, reason });
const ok = { ok: true as const };
const random = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const login = (email: string) => email.trim().toLowerCase();
const subFor = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export type CodeEmail = { email: string; kind: 'signup' | 'resend' | 'forgot'; lang: Lang };

export class MemoryIdentityProvider implements IdentityProvider {
  private readonly users = new Map<string, User>();
  private readonly challenges = new Map<string, Challenge>();
  private readonly refreshTokens = new Map<string, string>();
  private signUps = 0;
  readonly codeEmails: CodeEmail[] = [];
  constructor(private readonly clock: Clock) {}

  private bySub(sub: string) {
    return [...this.users.values()].find((u) => u.sub === sub);
  }
  private tokens(sub: string): Tokens {
    const refresh = random();
    this.refreshTokens.set(refresh, sub);
    return { access: random(), id: random(), refresh, expiresAt: this.clock.now() + HOUR };
  }
  private challenge(email: string, step: Challenge['step']) {
    const session = random();
    this.challenges.set(session, { email, step });
    return session;
  }

  /**
   * A confirmed person with an authenticator, under a given sub: STAGE=test people who sign in again to delete their
   * account (SF-169) and unit tests. Synthetic values only.
   */
  seedUser({ sub, email, password }: { sub: string; email: string; password: string }) {
    this.users.set(login(email), { sub, email: login(email), password, status: 'CONFIRMED', authenticator: true, resetPending: false });
  }

  async signUp(rawEmail: string, password: string, lang: Lang) {
    const email = login(rawEmail);
    if (this.users.has(email)) return fail('exists');
    this.signUps += 1;
    this.users.set(email, { sub: subFor(this.signUps), email, password, status: 'UNCONFIRMED', authenticator: false, resetPending: false });
    this.codeEmails.push({ email, kind: 'signup', lang });
    return ok;
  }
  async confirm(rawEmail: string, code: string) {
    const email = login(rawEmail);
    const user = this.users.get(email);
    if (!user) return fail('not_found');
    if (code !== TEST_EMAIL_CODE) return fail('bad_code');
    user.status = 'CONFIRMED';
    return ok;
  }
  async resend(rawEmail: string, lang: Lang) {
    const email = login(rawEmail);
    if (!this.users.has(email)) return fail('not_found');
    this.codeEmails.push({ email, kind: 'resend', lang });
    return ok;
  }
  async passwordAuth(rawEmail: string, password: string) {
    const email = login(rawEmail);
    const user = this.users.get(email);
    if (!user || user.password !== password) return fail('bad_credentials');
    if (user.status !== 'CONFIRMED') return fail('unconfirmed');
    const challenge: 'MFA_SETUP' | 'SOFTWARE_TOKEN_MFA' = user.authenticator ? 'SOFTWARE_TOKEN_MFA' : 'MFA_SETUP';
    return { ok: true as const, challenge, session: this.challenge(email, challenge) };
  }
  async associate(session: string) {
    const c = this.challenges.get(session);
    if (c?.step !== 'MFA_SETUP') return fail('bad_session');
    this.challenges.delete(session);
    const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => BASE32[b % 32]).join('');
    return { ok: true as const, secret, session: this.challenge(c.email, 'MFA_SETUP_ASSOCIATED') };
  }
  async verifySetup(rawEmail: string, session: string, code: string) {
    const email = login(rawEmail);
    const c = this.challenges.get(session);
    const user = c && this.users.get(c.email);
    if (c?.step !== 'MFA_SETUP_ASSOCIATED' || c.email !== email || !user) return fail('bad_session');
    if (code !== TEST_AUTHENTICATOR_CODE) return fail('bad_code');
    this.challenges.delete(session);
    user.authenticator = true;
    // Like Cognito: answering MFA_SETUP after the verified code completes the sign-in.
    return { ok: true as const, tokens: this.tokens(user.sub) };
  }
  async respondCode(rawEmail: string, session: string, code: string) {
    const email = login(rawEmail);
    const c = this.challenges.get(session);
    const user = this.users.get(email);
    if (c?.step !== 'SOFTWARE_TOKEN_MFA' || c.email !== email || !user) return fail('bad_session');
    if (code !== TEST_AUTHENTICATOR_CODE) return fail('bad_code');
    this.challenges.delete(session);
    return { ok: true as const, tokens: this.tokens(user.sub) };
  }
  async forgot(rawEmail: string, lang: Lang) {
    const email = login(rawEmail);
    const user = this.users.get(email);
    if (user) {
      user.resetPending = true;
      this.codeEmails.push({ email, kind: 'forgot', lang });
    }
    // The same reply whether or not the account exists, so the answer reveals nothing.
    return ok;
  }
  async confirmForgot(rawEmail: string, code: string, password: string) {
    const email = login(rawEmail);
    const user = this.users.get(email);
    if (!user?.resetPending || code !== TEST_EMAIL_CODE) return fail('bad_code');
    user.password = password;
    user.resetPending = false;
    return ok;
  }
  async refresh(sub: string, refreshToken: string) {
    if (this.refreshTokens.get(refreshToken) !== sub || !this.bySub(sub)) return fail('revoked');
    // Like Cognito without rotation: the refresh token stays the same.
    return { ok: true as const, tokens: { access: random(), id: random(), refresh: refreshToken, expiresAt: this.clock.now() + HOUR } };
  }
  async revoke(refreshToken: string) {
    this.refreshTokens.delete(refreshToken);
    return ok;
  }
  async adminGet(email: string) {
    const user = this.users.get(login(email));
    return user ? { ok: true as const, sub: user.sub, status: user.status } : fail('not_found');
  }
  async adminDelete(sub: string) {
    const user = this.bySub(sub);
    if (!user) return fail('not_found');
    this.users.delete(user.email);
    await this.adminGlobalSignOut(sub);
    return ok;
  }
  async adminGlobalSignOut(sub: string) {
    for (const [token, owner] of this.refreshTokens) if (owner === sub) this.refreshTokens.delete(token);
    return ok;
  }
}
