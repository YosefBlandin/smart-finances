import type { Session } from '@/application/session';
import type { AccountStore } from '@/ports/account-store';
import type { DataApi } from '@/ports/data-api';

// Erase all (SF-168; AC-7, data spec DELETE /data and the "erasing" row of States and exits). The data API takes the
// person from the access token, so only the signed-in person's data can go (AC-15). On 202 the account's stored bytes go
// back to zero (D-114: the row and its daily count stay). The reasons the screen tells apart:
//  - running: the API refused with conflict, as it does while an import runs or a period is locked; nothing was erased.
//  - unfinished: a timeout, a network failure or a server error. The API may have started, and an unfinished erase
//    keeps imports and totals refused until a repeat call finishes it, so the screen offers Finish erasing (the same call).
//  - limited: the person's request limit or the API's throttle; nothing was sent or nothing started.
//  - signed-out: the token was refused even after a refresh.
//  - failed: anything else (a refused request, not found, the counter unavailable); nothing was started.

export type EraseDeps = { dataApi: DataApi; accountStore: AccountStore };
export type Erased = { items: number; files: number };
export type EraseRefusal = 'running' | 'unfinished' | 'limited' | 'signed-out' | 'failed';
export type EraseResult = { ok: true; data: Erased } | { ok: false; reason: EraseRefusal; retryAfter?: number };

type Who = Pick<Session, 'accessToken' | 'sub'>;

/** The adapter's failure codes after which the API may have started erasing (a 2xx off the contract included). */
const MAY_HAVE_STARTED = new Set(['timeout', 'network', 'server', 'bad_reply']);

export function createErase({ dataApi, accountStore }: EraseDeps) {
  return {
    async erase(who: Who): Promise<EraseResult> {
      const result = await dataApi.erase(who.accessToken, { confirm: 'DELETE' });
      if (result.ok) {
        await accountStore.resetStoredBytes(who.sub);
        return { ok: true, data: { items: result.data.deleted.items, files: result.data.deleted.files } };
      }
      const refuse = (reason: EraseRefusal): EraseResult =>
        result.retryAfter === undefined ? { ok: false, reason } : { ok: false, reason, retryAfter: result.retryAfter };
      switch (result.kind) {
        case 'conflict':
          return refuse('running');
        case 'limited':
          return refuse('limited');
        case 'unauthorized':
          return refuse('signed-out');
        case 'failed':
          if (result.code === 'throttled') return refuse('limited');
          return refuse(MAY_HAVE_STARTED.has(result.code ?? '') ? 'unfinished' : 'failed');
        default:
          return refuse('failed');
      }
    },
  };
}

export type Erase = ReturnType<typeof createErase>;
