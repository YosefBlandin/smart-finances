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
// the data API is asked. It then asks POST /imports and reserves the slot under the import id the API gave, by one
// conditional update of the account row, which alone decides when requests race (D-114): the release at the final
// status finds the slot by that id. A request that loses the race gets no upload form, so its record expires as
// "never arrived". getImport reads an import and, at its final status, releases the slot: a file that never arrived
// gives its bytes back; any other final status keeps the source's maximum counted, since the web server never learns
// the stored size. A slot whose import ended while nobody watched is settled by the next request.

export type ImportsDeps = {
  dataApi: DataApi;
  accountStore: AccountStore;
  parameterStore: ParameterStore;
  clock: Clock;
  settings: Settings;
  logger: Logger;
};

type Who = Pick<Session, 'accessToken' | 'sub'>;
type ImportRecord = Awaited<ReturnType<DataApi['getImport']>> extends DataApiResult<infer T> ? T : never;
type Requested = Awaited<ReturnType<DataApi['requestImport']>> extends DataApiResult<infer T> ? T : never;

export type ImportRequest = { source: string; fileName: string; size: number };
export type ImportRefusal =
  'source' | 'empty' | 'name' | 'too_large' | 'paused' | 'unavailable' | ReserveRefusal | 'conflict' | 'limited' | 'unauthorized' | 'failed';
export type RequestResult =
  | { ok: true; data: { importId: string; upload: Requested['upload']; expiresAt: string } }
  | { ok: false; reason: ImportRefusal; retryAfter?: number };

const MiB = 1024 * 1024;
/** The per-person caps (architecture.md Contracts "Limits"); the account store's conditional update enforces them. */
export const IMPORT_CAPS = { perDay: 10, storedBytes: 200 * MiB } as const;

/** Statuses after which an import no longer changes (data spec "States and exits"); stalled waits for a repair. */
export const FINAL_STATUSES: readonly string[] = ['done', 'unchanged', 'superseded', 'failed', 'expired'];

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

const maxBytesOf = (source: string) => (Object.hasOwn(SOURCES, source) ? SOURCES[source as keyof typeof SOURCES].maxBytes : 0);

export function createImports(deps: ImportsDeps) {
  const { dataApi, accountStore, parameterStore, clock, settings, logger } = deps;

  /** Releases the person's slot for this import if it is the one running: its bytes back when no file arrived. */
  async function settle(sub: string, record: ImportRecord) {
    if (!FINAL_STATUSES.includes(record.status)) return;
    const account = await accountStore.getAccount(sub);
    if (account?.runningImportId !== record.import_id) return;
    await accountStore.releaseImport(sub, record.import_id, record.status === 'expired' ? 0 : maxBytesOf(record.source));
  }

  async function paused(): Promise<boolean | 'unreadable'> {
    try {
      return (await parameterStore.get(PAUSE_PARAMETER(settings.get().STAGE))) === 'true';
    } catch {
      return 'unreadable';
    }
  }

  return {
    async requestImport(who: Who, request: ImportRequest): Promise<RequestResult> {
      const bad = checkFile(request);
      if (bad) return refuse(bad);
      const pause = await paused();
      if (pause === 'unreadable') return refuse('unavailable');
      if (pause) return refuse('paused');

      let account = await accountStore.getAccount(who.sub);
      if (account?.runningImportId) {
        // The running import may have ended while nobody watched it: settle it first.
        const running = await dataApi.getImport(who.accessToken, { id: account.runningImportId });
        if (running.ok) await settle(who.sub, running.data);
        else if (running.kind === 'not_found') await accountStore.releaseImport(who.sub, account.runningImportId, 0);
        account = await accountStore.getAccount(who.sub);
      }
      const bytes = maxBytesOf(request.source);
      const day = utcDay(clock.now());
      if (account?.runningImportId) return refuse('running');
      if (account?.importsToday?.day === day && account.importsToday.n >= IMPORT_CAPS.perDay) return refuse('daily');
      if ((account?.storedBytes ?? 0) + bytes > IMPORT_CAPS.storedBytes) return refuse('bytes');

      const asked = await dataApi.requestImport(who.accessToken, { source: request.source, file_name: request.fileName, size: request.size });
      if (!asked.ok) {
        if (asked.kind === 'limited') return refuse('limited', asked.retryAfter);
        if (asked.kind === 'unauthorized') return refuse('unauthorized');
        if (asked.kind === 'conflict') return refuse('conflict');
        if (asked.code === 'too_large') return refuse('too_large');
        if (asked.code === 'bad_request') return refuse('name');
        return refuse('failed', asked.retryAfter);
      }
      const reserved = await accountStore.reserveImport(who.sub, { day, bytes, importId: asked.data.import_id });
      if (!reserved.ok) {
        logger.event('import_refused', reserved.reason, { sub: who.sub, requestId: asked.data.import_id });
        return refuse(reserved.reason);
      }
      return { ok: true, data: { importId: asked.data.import_id, upload: asked.data.upload, expiresAt: asked.data.expires_at } };
    },

    /** One import, as the API answers it; at its final status the person's slot is released (D-114). */
    async getImport(who: Who, id: string): Promise<DataApiResult<ImportRecord>> {
      const read = await dataApi.getImport(who.accessToken, { id });
      if (read.ok) {
        try {
          await settle(who.sub, read.data);
        } catch {
          // The read still answers; the next request settles the slot again.
          logger.event('import_release', 'failed', { sub: who.sub, requestId: id });
        }
      }
      return read;
    },
  };
}
