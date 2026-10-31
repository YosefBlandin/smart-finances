import type { Clock } from '@/ports/clock';
import type { IdentityFailure, IdentityProvider, Tokens } from '@/ports/identity-provider';

// The test identity fake: every email code is 123456 and every authenticator code is 000000 (PR 3 relies on these).
export const TEST_EMAIL_CODE = '123456';
export const TEST_AUTHENTICATOR_CODE = '000000';
const HOUR = 3_600_000;

type User = { sub: string; email: string; password: string; status: 'UNCONFIRMED' | 'CONFIRMED'; authenticator: boolean; resetPending: boolean };
type Challenge = { email: string; step: 'MFA_SETUP' | 'MFA_SETUP_ASSOCIATED' | 'SOFTWARE_TOKEN_MFA' };

const fail = (reason: IdentityFailure) => ({ ok: false as const, reason });
const ok = { ok: true as const };
const random = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export class MemoryIdentityProvider implements IdentityProvider {
  private readonly users = new Map<string, User>();
  private readonly challenges = new Map<string, Challenge>();
  private readonly refreshTokens = new Map<string, string>();
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

  async signUp(email: string, password: string) {
    if (this.users.has(email)) return fail('exists');
    this.users.set(email, { sub: crypto.randomUUID(), email, password, status: 'UNCONFIRMED', authenticator: false, resetPending: false });
    return ok;
  }
  async confirm(email: string, code: string) {
    const user = this.users.get(email);
    if (!user) return fail('not_found');
    if (code !== TEST_EMAIL_CODE) return fail('bad_code');
    user.status = 'CONFIRMED';
    return ok;
  }
  async resend(email: string) {
    return this.users.has(email) ? ok : fail('not_found');
  }
  async passwordAuth(email: string, password: string) {
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
  async verifySetup(session: string, code: string) {
    const c = this.challenges.get(session);
    const user = c && this.users.get(c.email);
    if (c?.step !== 'MFA_SETUP_ASSOCIATED' || !user) return fail('bad_session');
    if (code !== TEST_AUTHENTICATOR_CODE) return fail('bad_code');
    this.challenges.delete(session);
    user.authenticator = true;
    return ok;
  }
  async respondCode(email: string, session: string, code: string) {
    const c = this.challenges.get(session);
    const user = this.users.get(email);
    if (c?.step !== 'SOFTWARE_TOKEN_MFA' || c.email !== email || !user) return fail('bad_session');
    if (code !== TEST_AUTHENTICATOR_CODE) return fail('bad_code');
    this.challenges.delete(session);
    return { ok: true as const, tokens: this.tokens(user.sub) };
  }
  async forgot(email: string) {
    const user = this.users.get(email);
    if (user) user.resetPending = true;
    // The same reply whether or not the account exists, so the answer reveals nothing.
    return ok;
  }
  async confirmForgot(email: string, code: string, password: string) {
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
    const user = this.users.get(email);
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
