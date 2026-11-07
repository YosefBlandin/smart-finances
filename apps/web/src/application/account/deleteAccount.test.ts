/* eslint-disable import/no-restricted-paths -- T-WSCR-11 drives the delete-account use case over the memory adapters
   (the STAGE=test container); no production application code imports adapters. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memoryContainer, type Container } from '@/adapters/container';
import { MemoryClock } from '@/adapters/memory/clock';
import { fixtureSeed, MemoryDataApi } from '@/adapters/memory/data-api';
import { TEST_AUTHENTICATOR_CODE, type MemoryIdentityProvider } from '@/adapters/memory/identity-provider';
import type { MemoryLogger } from '@/adapters/memory/logger';
import type { MemorySecretStore } from '@/adapters/memory/secret-store';
import { TEST_SETTINGS } from '@/adapters/memory/settings';
import { createImports } from '@/application/data/requestImport';
import { DELETION_STEPS, GOODBYE, type DeletionStep } from '@/domain/deletion';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/legal/versions';
import { createDeleteAccount, ERASE_ATTEMPTS, STEP_ATTEMPTS } from './deleteAccount';

// T-WSCR-11 (AC-18, D-104): deleting an account starts with a full re-sign-in (password and authenticator code of this
// very person) and no running import, then marks the account deleting; the finish runs D-104's steps in order (erase,
// sign out everywhere, delete the pool user, delete the account row). A deletion that fails at any step is finished by
// calling finish again for the same person. The goodbye cookie is signed with the stage's HMAC secret and lasts 5
// minutes. Memory adapters, synthetic people only.

const START = Date.UTC(2026, 10, 6, 12, 0, 0);
const SUB = 'delete-person-sub';
const EMAIL = 'delete-person@example.test';
const PASSWORD = 'test phrase delete one';
const WHO = { sub: SUB, accessToken: 'delete-person-token' };
const CTX = { requestId: 'req-delete', ip: '10.0.0.7', lang: 'en' as const };
const RIGHT = { email: EMAIL, password: PASSWORD, code: TEST_AUTHENTICATOR_CODE };
// The fixtures: 561 transactions, 11 rates and 12 imports, which the memory erase counts as 584 records and 12 files.
const ERASED = { items: 584, files: 12 };

function setup() {
  const clock = new MemoryClock(START);
  const c: Container = memoryContainer(undefined, clock);
  const identity = c.identityProvider as MemoryIdentityProvider;
  identity.seedUser({ sub: SUB, email: EMAIL, password: PASSWORD });
  identity.seedUser({ sub: 'someone-else-sub', email: 'someone-else@example.test', password: 'test phrase someone else' });
  const api = c.dataApi as MemoryDataApi;
  api.allowToken(WHO.accessToken);
  api.seed(fixtureSeed());
  const now = clock.now();
  void c.accountStore.putConsent(SUB, { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, lang: 'en', acceptedAt: now });
  for (const id of ['browser-one', 'browser-two']) {
    void c.sessionStore.create({
      idHash: createHash('sha256').update(id).digest('hex'),
      sub: SUB,
      accessToken: WHO.accessToken,
      idToken: 'id',
      refreshToken: `refresh-${id}`,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + 3_600_000,
    });
  }
  const deps = { ...c, sleep: async (ms: number) => clock.advance(ms) };
  return { c, clock, identity, api, deletion: createDeleteAccount(deps) };
}

type Setup = ReturnType<typeof setup>;

/** Makes one step fail for its every attempt within one finish call; returns the restore. */
function breakStep(s: Setup, step: DeletionStep): () => void {
  const { c, identity, api } = s;
  switch (step) {
    case 'erase': {
      const erase = api.erase.bind(api);
      api.erase = async () => ({ ok: false, kind: 'failed', code: 'timeout' });
      return () => (api.erase = erase);
    }
    case 'sign-out': {
      const signOut = identity.adminGlobalSignOut.bind(identity);
      identity.adminGlobalSignOut = async () => ({ ok: false, reason: 'failed' }) as unknown as { ok: true };
      return () => (identity.adminGlobalSignOut = signOut);
    }
    case 'delete-user': {
      const adminDelete = identity.adminDelete.bind(identity);
      identity.adminDelete = async () => ({ ok: false, reason: 'failed' });
      return () => (identity.adminDelete = adminDelete);
    }
    case 'delete-row': {
      const deleteRow = c.accountStore.deleteAccountRow.bind(c.accountStore);
      c.accountStore.deleteAccountRow = async () => {
        throw new Error('the accounts table is unavailable');
      };
      return () => (c.accountStore.deleteAccountRow = deleteRow);
    }
  }
}

/** What is left of the person after a finish: data, sessions, the pool user and the account row. */
async function left(s: Setup) {
  const imports = await s.api.listImports(WHO.accessToken, {});
  return {
    imports: imports.ok ? imports.data.items.length : -1,
    sessions: (await s.c.sessionStore.listBySub(SUB)).length,
    user: (await s.identity.adminGet(EMAIL)).ok,
    account: (await s.c.accountStore.getAccount(SUB)) !== undefined,
  };
}

describe('T-WSCR-11: delete account (D-104)', () => {
  it('T-WSCR-11: start needs this person’s password and authenticator code, then marks the account deleting', async () => {
    const s = setup();
    expect(await s.deletion.start(WHO, { ...RIGHT, password: 'not the password at all' }, CTX)).toMatchObject({
      ok: false,
      messageKey: 'auth.signIn.errWrong',
    });
    expect(await s.deletion.start(WHO, { ...RIGHT, code: '111111' }, CTX)).toMatchObject({ ok: false, messageKey: 'auth.code.errWrong' });
    // Another person's email and password, even with a right code, is refused: the code must belong to the signed-in sub.
    expect(
      await s.deletion.start(WHO, { email: 'someone-else@example.test', password: 'test phrase someone else', code: TEST_AUTHENTICATOR_CODE }, CTX),
    ).toMatchObject({
      ok: false,
      messageKey: 'auth.signIn.errWrong',
    });
    expect((await s.c.accountStore.getAccount(SUB))?.status).toBe('active');

    expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: true });
    const account = await s.c.accountStore.getAccount(SUB);
    expect(account?.status).toBe('deleting');
    expect(account?.deletingSince).toBe(s.clock.now());
    // The re-sign-in creates no session: still the two browsers' sessions.
    expect(await left(s)).toEqual({ imports: 12, sessions: 2, user: true, account: true });
    const events = (s.c.logger as MemoryLogger).events.filter((e) => e.name === 'account_delete');
    expect(events.map((e) => e.outcome)).toEqual(['started']);
  });

  it('T-WSCR-11: start is refused while an import runs, and goes ahead once it has ended', async () => {
    const s = setup();
    const imported = await createImports(s.c).requestImport(WHO, { source: 'mercadopago', fileName: 'release-report-2026-10.csv', size: 1_200 }, CTX);
    expect(imported.ok).toBe(true);
    expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: false, messageKey: 'auth.delete.running' });
    expect((await s.c.accountStore.getAccount(SUB))?.status).toBe('active');
    // The import ends while nobody watches it: the next start settles its slot first.
    s.clock.advance(60_000);
    expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: true });
  });

  it('T-WSCR-11: markDeleting is one conditional write, refused while an import runs (memory adapter)', async () => {
    const s = setup();
    await s.c.accountStore.reserveImport(SUB, { day: '2026-11-06', bytes: 1, importId: 'imp-running' });
    expect(await s.c.accountStore.markDeleting(SUB, START)).toEqual({ ok: false, reason: 'running' });
    expect((await s.c.accountStore.getAccount(SUB))?.status).toBe('active');
    await s.c.accountStore.releaseImport(SUB, 'imp-running', 1);
    expect(await s.c.accountStore.markDeleting(SUB, START)).toEqual({ ok: true });
  });

  it('T-WSCR-11: an import that starts between the check and the mark refuses the start with the import message', async () => {
    const s = setup();
    const store = s.c.accountStore;
    const mark = store.markDeleting.bind(store);
    store.markDeleting = async (sub, now) => {
      // Another tab's import reserves its slot just after start found none running.
      await store.reserveImport(sub, { day: '2026-11-06', bytes: 1, importId: 'pending:1:other-tab' });
      return mark(sub, now);
    };
    expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: false, messageKey: 'auth.delete.running' });
    expect((await store.getAccount(SUB))?.status).toBe('active');
    const events = (s.c.logger as MemoryLogger).events.filter((e) => e.name === 'account_delete');
    expect(events).toEqual([]);
  });

  it('T-WSCR-11: a placeholder slot (an import being requested) counts as running', async () => {
    const s = setup();
    await s.c.accountStore.reserveImport(SUB, { day: '2026-11-06', bytes: 1, importId: `pending:${START}:other-tab` });
    expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: false, messageKey: 'auth.delete.running' });
    expect((await s.c.accountStore.getAccount(SUB))?.status).toBe('active');
  });

  it('T-WSCR-11: finish is refused for an account that has not been through start', async () => {
    const s = setup();
    expect(await s.deletion.finish(WHO, CTX)).toEqual({ ok: false, reason: 'not-deleting' });
    expect(await left(s)).toEqual({ imports: 12, sessions: 2, user: true, account: true });
  });

  it('T-WSCR-11: the steps run in the order of D-104 and remove everything', async () => {
    const s = setup();
    const order: string[] = [];
    const trace = <T extends object, K extends keyof T>(o: T, k: K, name: string) => {
      const fn = (o[k] as (...a: unknown[]) => unknown).bind(o);
      (o as Record<K, unknown>)[k] = (...a: unknown[]) => {
        order.push(name);
        return fn(...a);
      };
    };
    trace(s.api, 'erase', 'erase');
    trace(s.identity, 'adminGlobalSignOut', 'sign-out');
    trace(s.identity, 'adminDelete', 'delete-user');
    trace(s.c.accountStore, 'deleteAccountRow', 'delete-row');
    expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: true });
    expect(await s.deletion.finish(WHO, CTX)).toEqual({ ok: true, erased: ERASED });
    // The pool's own delete signs out again, so each step is named by its first call.
    expect(order.filter((name, i) => order.indexOf(name) === i)).toEqual([...DELETION_STEPS]);
    expect(await left(s)).toEqual({ imports: 0, sessions: 0, user: false, account: false });
    const events = (s.c.logger as MemoryLogger).events.filter((e) => e.name === 'account_delete');
    expect(events.map((e) => e.outcome)).toEqual(['started', 'done']);
  });

  it.each(DELETION_STEPS)(
    'T-WSCR-11: every step is repeatable: a deletion that stops at %s finishes when finish runs again, as the hourly job does',
    async (step) => {
      const s = setup();
      expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: true });
      const restore = breakStep(s, step);
      const failed = await s.deletion.finish(WHO, CTX);
      expect(failed).toMatchObject({ ok: false, reason: 'step', step });
      // The steps before it are done and the ones after it are not. Signing out removes the session rows even when the
      // pool's global sign-out fails, so from that step on this person has no session left.
      const at = DELETION_STEPS.indexOf(step);
      const after = await left(s);
      expect(after.imports).toBe(at > 0 ? 0 : 12);
      expect(after.sessions).toBe(at >= 1 ? 0 : 2);
      expect(after.user).toBe(at <= 2);
      expect(after.account).toBe(true);
      expect((await s.c.accountStore.getAccount(SUB))?.status).toBe('deleting');
      if (at > 0) expect(failed).toMatchObject({ erased: ERASED });

      restore();
      const finished = await s.deletion.finish(WHO, CTX);
      expect(finished.ok).toBe(true);
      if (step === 'erase' && finished.ok) expect(finished.erased).toEqual(ERASED);
      expect(await left(s)).toEqual({ imports: 0, sessions: 0, user: false, account: false });
      const outcomes = (s.c.logger as MemoryLogger).events.filter((e) => e.name === 'account_delete').map((e) => e.outcome);
      expect(outcomes).toEqual(['started', `failed_${step}`, 'done']);
    },
  );

  it('T-WSCR-11: one finish tries the erase once (it has 25 s, the host cuts at about 30 s); the next finish resumes it', async () => {
    expect(ERASE_ATTEMPTS).toBe(1);
    const s = setup();
    expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: true });
    let erases = 0;
    const erase = s.api.erase.bind(s.api);
    s.api.erase = async (token, input) => {
      erases += 1;
      return erases === 1 ? { ok: false, kind: 'failed', code: 'timeout' } : erase(token, input);
    };
    expect(await s.deletion.finish(WHO, CTX)).toEqual({ ok: false, reason: 'step', step: 'erase' });
    expect(erases).toBe(1);
    expect(await s.deletion.finish(WHO, CTX)).toEqual({ ok: true, erased: ERASED });
    expect(erases).toBe(2);
  });

  it('T-WSCR-11: each step after the erase is tried again within one finish before it gives up', async () => {
    const s = setup();
    expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: true });
    let deletes = 0;
    const adminDelete = s.identity.adminDelete.bind(s.identity);
    s.identity.adminDelete = async (sub) => {
      deletes += 1;
      return deletes < STEP_ATTEMPTS ? { ok: false, reason: 'failed' } : adminDelete(sub);
    };
    expect(await s.deletion.finish(WHO, CTX)).toEqual({ ok: true, erased: ERASED });
    expect(STEP_ATTEMPTS).toBeGreaterThan(1);
    expect(deletes).toBe(STEP_ATTEMPTS);
  });

  it('T-WSCR-11: a pool user that is already gone counts as deleted', async () => {
    const s = setup();
    expect(await s.deletion.start(WHO, RIGHT, CTX)).toEqual({ ok: true });
    await s.identity.adminDelete(SUB);
    expect(await s.deletion.finish(WHO, CTX)).toEqual({ ok: true, erased: ERASED });
    expect(await left(s)).toEqual({ imports: 0, sessions: 0, user: false, account: false });
  });

  it('T-WSCR-11: the goodbye cookie is signed, holds only the counts, and lasts 5 minutes', async () => {
    const s = setup();
    expect(GOODBYE).toMatchObject({ cookie: '__Host-goodbye', maxAgeSeconds: 300 });
    const value = await s.deletion.goodbye({ erased: ERASED, closed: 'done' });
    expect(value).not.toContain(SUB);
    expect(value).not.toContain(EMAIL);
    expect(await s.deletion.readGoodbye(value)).toEqual({ erased: ERASED, closed: 'done' });
    expect(await s.deletion.readGoodbye(undefined)).toBeNull();
    expect(await s.deletion.readGoodbye('not a goodbye')).toBeNull();

    // Changed counts break the signature.
    const [payload, sig] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), items: 1 })).toString('base64url');
    expect(await s.deletion.readGoodbye(`${forged}.${sig}`)).toBeNull();

    // Another stage's secret does not read it.
    (s.c.secretStore as MemorySecretStore).set(TEST_SETTINGS.HMAC_SECRET_ARN, 'a-different-test-secret');
    expect(await s.deletion.readGoodbye(value)).toBeNull();
    (s.c.secretStore as MemorySecretStore).set(TEST_SETTINGS.HMAC_SECRET_ARN, 'test-hmac-secret');

    // A partly finished deletion says so; neither reads after 5 minutes.
    const partial = await s.deletion.goodbye({ closed: 'partial' });
    expect(await s.deletion.readGoodbye(partial)).toEqual({ closed: 'partial' });
    s.clock.advance(GOODBYE.maxAgeSeconds * 1000 + 1);
    expect(await s.deletion.readGoodbye(value)).toBeNull();
    expect(await s.deletion.readGoodbye(partial)).toBeNull();
  });
});
