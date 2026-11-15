// Accept all's save pool (category-suggestions D-25, AC-8, AC-9): the existing review choice for each row, a few at a
// time. Each call is handled on its own: a thrown or rejected call, a refusal, or no answer in time fails only its row,
// and the pool goes on. A refusal that asks for a wait of at most maxRetryWaitS is retried once after that wait, with
// the seconds left reported. It resolves with the failed ids, in the order given, after every call settles; it never
// rejects and never logs, so no row text can reach browser monitoring.

export type SaveChoice = { id: string; date: string; category: string; approved: true };
export type SaveResult = { ok: true } | { ok: false; messageKey: string; retryAfterSeconds?: number };
export type SaveOptions = {
  /** Calls in flight at once; 4 by default. */
  concurrency?: number;
  /** A call with no answer after this long fails its row; 20 s by default. */
  timeoutMs?: number;
  /** The longest refusal wait that is retried; 60 s by default. */
  maxRetryWaitS?: number;
  /** Seconds left before a retry, each second down to 0. */
  onWait?: (secondsLeft: number) => void;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One call, as a result: a throw, a rejection or no answer in time is a refusal with no wait. A timed-out call counts as
 * settled on purpose (T-POOL-2 resolves at 20 s): its request may still finish, but the row is reported failed and put
 * back, and the next visit shows what the server saved.
 */
async function once(choose: (c: SaveChoice) => Promise<SaveResult>, choice: SaveChoice, timeoutMs: number): Promise<SaveResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SaveResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, messageKey: 'timeout' }), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => choose(choice)), timeout]);
  } catch {
    return { ok: false, messageKey: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function saveAll(choices: SaveChoice[], choose: (c: SaveChoice) => Promise<SaveResult>, opts: SaveOptions = {}): Promise<string[]> {
  const { concurrency = 4, timeoutMs = 20_000, maxRetryWaitS = 60, onWait } = opts;
  const failed = new Set<string>();
  let next = 0;

  async function save(choice: SaveChoice): Promise<void> {
    const first = await once(choose, choice, timeoutMs);
    if (first.ok) return;
    const wait = first.retryAfterSeconds;
    if (wait === undefined || !(wait >= 0) || wait > maxRetryWaitS) {
      failed.add(choice.id);
      return;
    }
    for (let left = Math.ceil(wait); left >= 0; left -= 1) {
      try {
        onWait?.(left);
      } catch {
        // The display of the wait never fails a row.
      }
      if (left > 0) await sleep(1_000);
    }
    const second = await once(choose, choice, timeoutMs);
    if (!second.ok) failed.add(choice.id);
  }

  async function worker(): Promise<void> {
    while (next < choices.length) {
      const choice = choices[next]!;
      next += 1;
      try {
        await save(choice);
      } catch {
        failed.add(choice.id);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, choices.length)) }, () => worker()));
  return choices.filter((c) => failed.has(c.id)).map((c) => c.id);
}
