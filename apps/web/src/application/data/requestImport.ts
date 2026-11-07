import { checkImportRequest, SOURCES } from '@smart-finances/contracts/routes';
import type { Session } from '@/application/session';
import type { AccountStore, ReserveRefusal } from '@/ports/account-store';
import type { Clock } from '@/ports/clock';
import type { DataApi, DataApiResult } from '@/ports/data-api';
import type { Logger } from '@/ports/logger';
import type { ParameterStore } from '@/ports/parameter-store';
import type { Settings } from '@/ports/settings';

// Imports with caps (SF-167; AC-5, AC-17, D-96, D-114). requestImport checks the file's name and size with the
// contracts' SOURCES (the API's own check), then the pause switch (the imports-paused stage parameter: "true" pauses;
// a switch that cannot be read refuses, so a failure never reads as "not paused"), then the account row's caps (10
// imports a UTC day, one running, stored bytes plus the source's maximum within 200 MiB) for a plain refusal before
// the data API is asked. The reservation counts the file's declared size (checked with the contracts), not the source's
// maximum (owner decision of 2026-11-06). It then reserves the slot under a placeholder id (pending:<ms>:<uuid>) by one conditional
// update of the account row, which alone decides when requests race (D-114), so only the winner asks POST /imports. On
// success confirmImport swaps the placeholder for the API's import id, conditional on the placeholder, and the release
// at the final status finds the slot by that id; a refused, failed or thrown POST /imports releases the placeholder, its
// bytes and, while it is still the same UTC day, the day's count, conditional on the placeholder (owner decision of
// 2026-11-06). A placeholder on the row counts as running (an account being deleted cannot be marked meanwhile, AC-18);
// one older than PENDING_STALE_MS was left by a request that stopped before its answer, which handed out no upload form,
// so the next request or deletion releases it the same way. getImport reads an import and, at its final status or
// stalled, releases the slot: a file that never arrived gives its bytes back; any other status keeps the declared size
// counted, since the web server never learns the stored size. Each release is conditional on the slot's id, so it
// happens once. A slot whose import ended while nobody watched is settled by the next request.

export type ImportsDeps = {
  dataApi: DataApi;
  accountStore: AccountStore;
  parameterStore: ParameterStore;
  clock: Clock;
  settings: Settings;
  logger: Logger;
};

type Who = Pick<Session, 'accessToken' | 'sub'>;
/**
 * The request being served: its id goes into the import events (import_refused, import_release) as request_id. The
 * import or placeholder id is never logged: the Logger port carries only sub and request_id, and the contracts bound
 * no import id (owner decision of 2026-11-06: log it validated against a contract id schema, or omit it).
 */
export type ImportContext = { requestId: string };
type ImportRecord = Awaited<ReturnType<DataApi['getImport']>> extends DataApiResult<infer T> ? T : never;
type Requested = Awaited<ReturnType<DataApi['requestImport']>> extends DataApiResult<infer T> ? T : never;

export type ImportRequest = { source: string; fileName: string; size: number };
export type ImportRefusal =
  | 'source'
  | 'empty'
  | 'name'
  | 'too_large'
  | 'paused'
  | 'unavailable'
  | Exclude<ReserveRefusal, 'deleting'>
  | 'conflict'
  | 'limited'
  | 'unauthorized'
  | 'failed';
export type RequestResult =
  | { ok: true; data: { importId: string; upload: Requested['upload']; expiresAt: string } }
  | { ok: false; reason: ImportRefusal; retryAfter?: number };

const MiB = 1024 * 1024;
/** The per-person caps (architecture.md Contracts "Limits"); the account store's conditional update enforces them. */
export const IMPORT_CAPS = { perDay: 10, storedBytes: 200 * MiB } as const;

/** Statuses after which an import no longer changes (data spec "States and exits"); stalled waits for a repair. */
export const FINAL_STATUSES: readonly string[] = ['done', 'unchanged', 'superseded', 'failed', 'expired'];

/**
 * Statuses at which the person's slot is released (D-114): the final ones and stalled, whose lock frees itself (data
 * spec "States and exits"); the person repairs it or uploads again.
 */
export const SLOT_FREE_STATUSES: readonly string[] = [...FINAL_STATUSES, 'stalled'];

/** The prefix of a placeholder slot id: pending:<epoch ms>:<uuid>, held while POST /imports is asked (D-114). */
export const PENDING_IMPORT = 'pending:';
/**
 * A placeholder older than this was left by a request that stopped before POST /imports answered (the data API's own
 * timeout is 5 s): no upload form went out, so the slot is released with no bytes.
 */
export const PENDING_STALE_MS = 2 * 60_000;

/** When a placeholder slot was taken, or undefined for a real import id. */
export function pendingSince(id: string): number | undefined {
  if (!id.startsWith(PENDING_IMPORT)) return undefined;
  const at = Number(id.slice(PENDING_IMPORT.length).split(':')[0]);
  return Number.isFinite(at) ? at : 0;
}

/** How long an import requested from the STAGE=test data API runs (adapters/memory/data-api.ts). */
export const IMPORT_RUN_MS = 2_000;

/** The pause switch's name for a stage (architecture.md Contracts "Stage parameters"). */
export const PAUSE_PARAMETER = (stage: string) => `/smart-finances/${stage}/imports-paused`;

const refuse = (reason: ImportRefusal, retryAfter?: number): RequestResult =>
  retryAfter === undefined ? { ok: false, reason } : { ok: false, reason, retryAfter };

/** The UTC day of an epoch-millisecond time, as the account row counts imports (D-114). */
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The contracts' check, as a reason the screen words. */
function checkFile({ source, fileName, size }: ImportRequest): ImportRefusal | undefined {
  if (!Object.hasOwn(SOURCES, source)) return 'source';
  const check = checkImportRequest({ source, file_name: fileName, size });
  if (check.ok) return undefined;
  if (check.code === 'too_large') return 'too_large';
  return Number.isInteger(size) && size >= 1 ? 'name' : 'empty';
}

export function createImports(deps: ImportsDeps) {
  const { dataApi, accountStore, parameterStore, clock, settings, logger } = deps;

  /**
   * Releases the person's slot for this import if it is the one running: the reserved (declared) size stays counted,
   * or comes back when no file arrived.
   */
  async function settle(sub: string, record: ImportRecord) {
    if (!SLOT_FREE_STATUSES.includes(record.status)) return;
    const account = await accountStore.getAccount(sub);
    if (account?.runningImportId !== record.import_id) return;
    await accountStore.releaseImport(sub, record.import_id, record.status === 'expired' ? 0 : (account.runningImportBytes ?? 0));
  }

  /**
   * Releases a placeholder slot taken on day: its bytes back, and the day's count back while it is still that UTC day
   * (the request handed out no upload form). Conditional on the placeholder, like every release.
   */
  async function releasePlaceholder(sub: string, placeholder: string, day: string) {
    await accountStore.releaseImport(sub, placeholder, 0, utcDay(clock.now()) === day ? { giveBackDay: day } : {});
  }

  /**
   * The person's account after settling a running slot whose import has ended (or never existed, or whose placeholder
   * was left past its time); a slot still running stays.
   */
  async function settleRunning(who: Who) {
    const account = await accountStore.getAccount(who.sub);
    const id = account?.runningImportId;
    if (!id) return account;
    const since = pendingSince(id);
    if (since !== undefined) {
      if (clock.now() - since < PENDING_STALE_MS) return account;
      await releasePlaceholder(who.sub, id, utcDay(since));
    } else {
      const running = await dataApi.getImport(who.accessToken, { id });
      if (running.ok) await settle(who.sub, running.data);
      else if (running.kind === 'not_found') await accountStore.releaseImport(who.sub, id, 0);
      else return account;
    }
    return accountStore.getAccount(who.sub);
  }

  async function paused(): Promise<boolean | 'unreadable'> {
    try {
      return (await parameterStore.get(PAUSE_PARAMETER(settings.get().STAGE))) === 'true';
    } catch {
      return 'unreadable';
    }
  }

  return {
    settleRunning,

    async requestImport(who: Who, request: ImportRequest, ctx: ImportContext): Promise<RequestResult> {
      const bad = checkFile(request);
      if (bad) return refuse(bad);
      const pause = await paused();
      if (pause === 'unreadable') return refuse('unavailable');
      if (pause) return refuse('paused');

      // The running import may have ended while nobody watched it: settle it first.
      const account = await settleRunning(who);
      const bytes = request.size;
      const day = utcDay(clock.now());
      if (account?.runningImportId) return refuse('running');
      if (account?.importsToday?.day === day && account.importsToday.n >= IMPORT_CAPS.perDay) return refuse('daily');
      if ((account?.storedBytes ?? 0) + bytes > IMPORT_CAPS.storedBytes) return refuse('bytes');

      const placeholder = `${PENDING_IMPORT}${clock.now()}:${crypto.randomUUID()}`;
      const reserved = await accountStore.reserveImport(who.sub, { day, bytes, importId: placeholder });
      if (!reserved.ok) {
        logger.event('import_refused', reserved.reason, { sub: who.sub, requestId: ctx.requestId });
        // An account being deleted reads like a session that ended: no import starts during a deletion (AC-18).
        return refuse(reserved.reason === 'deleting' ? 'unauthorized' : reserved.reason);
      }
      const giveBack = async () => {
        try {
          await releasePlaceholder(who.sub, placeholder, day);
        } catch {
          // Left on the row, the placeholder is released once PENDING_STALE_MS have passed.
          logger.event('import_release', 'failed', { sub: who.sub, requestId: ctx.requestId });
        }
      };
      let asked: Awaited<ReturnType<DataApi['requestImport']>>;
      try {
        asked = await dataApi.requestImport(who.accessToken, { source: request.source, file_name: request.fileName, size: request.size });
      } catch (err) {
        await giveBack();
        throw err;
      }
      if (!asked.ok) {
        await giveBack();
        if (asked.kind === 'limited') return refuse('limited', asked.retryAfter);
        if (asked.kind === 'unauthorized') return refuse('unauthorized');
        if (asked.kind === 'conflict') return refuse('conflict');
        if (asked.code === 'too_large') return refuse('too_large');
        if (asked.code === 'bad_request') return refuse('name');
        return refuse('failed', asked.retryAfter);
      }
      if (!(await accountStore.confirmImport(who.sub, placeholder, asked.data.import_id))) {
        // The placeholder no longer holds the slot: this import gets no upload form, so its record expires.
        logger.event('import_refused', 'conflict', { sub: who.sub, requestId: ctx.requestId });
        return refuse('conflict');
      }
      return { ok: true, data: { importId: asked.data.import_id, upload: asked.data.upload, expiresAt: asked.data.expires_at } };
    },

    /** One import, as the API answers it; at its final status (or stalled) the person's slot is released (D-114). */
    async getImport(who: Who, id: string, ctx: ImportContext): Promise<DataApiResult<ImportRecord>> {
      const read = await dataApi.getImport(who.accessToken, { id });
      if (read.ok) {
        try {
          await settle(who.sub, read.data);
        } catch {
          // The read still answers; the next request settles the slot again.
          logger.event('import_release', 'failed', { sub: who.sub, requestId: ctx.requestId });
        }
      }
      return read;
    },
  };
}
