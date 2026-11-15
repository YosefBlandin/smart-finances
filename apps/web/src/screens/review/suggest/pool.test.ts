import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAll, type SaveChoice, type SaveResult } from './pool';

// T-POOL-1 to T-POOL-3 (category-suggestions D-25, AC-8): Accept all's save pool sends at most 4 at a time, fails only
// the row whose call throws, rejects or has no answer in 20 s, retries a refusal with a wait of 60 s or less once, and
// resolves with the failed ids after every call settles, never rejecting. Made-up ids only.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const choices = (n: number): SaveChoice[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, date: '2026-10-02', category: 'Groceries', approved: true }));

describe('T-POOL-1: concurrency', () => {
  it('T-POOL-1 never has more than 4 calls in flight, and sends every row once', async () => {
    let inFlight = 0;
    let most = 0;
    const sent: string[] = [];
    const choose = async (c: SaveChoice): Promise<SaveResult> => {
      sent.push(c.id);
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 100 + (Number(c.id.slice(1)) % 3) * 50));
      inFlight -= 1;
      return { ok: true };
    };
    const done = saveAll(choices(23), choose);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(done).resolves.toEqual([]);
    expect(most).toBe(4);
    expect([...sent].sort()).toEqual(
      choices(23)
        .map((c) => c.id)
        .sort(),
    );
  });

  it('T-POOL-1 the concurrency can be set, and an empty list resolves at once', async () => {
    let inFlight = 0;
    let most = 0;
    const choose = async (): Promise<SaveResult> => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return { ok: true };
    };
    const done = saveAll(choices(6), choose, { concurrency: 2 });
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(most).toBe(2);
    await expect(saveAll([], choose)).resolves.toEqual([]);
  });
});

describe('T-POOL-2: one row fails alone', () => {
  it('T-POOL-2 a thrown call, a rejected call and a call with no answer in 20 s fail only their rows; it never rejects', async () => {
    const calls = new Map<string, number>();
    const choose = (c: SaveChoice): Promise<SaveResult> => {
      calls.set(c.id, (calls.get(c.id) ?? 0) + 1);
      if (c.id === 'r2') throw new Error('boom');
      if (c.id === 'r3') return Promise.reject(new Error('rejected'));
      if (c.id === 'r4') return new Promise(() => {});
      if (c.id === 'r5') return Promise.resolve({ ok: false, messageKey: 'review.saveFailed' });
      return Promise.resolve({ ok: true });
    };
    let settled = false;
    const done = saveAll(choices(8), choose).then((ids) => {
      settled = true;
      return ids;
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(done).resolves.toEqual(['r2', 'r3', 'r4', 'r5']);
    // None of them is tried again.
    expect(['r2', 'r3', 'r4', 'r5'].map((id) => calls.get(id))).toEqual([1, 1, 1, 1]);
  });

  it('T-POOL-2 the timeout can be set, and errors never reach the caller', async () => {
    const done = saveAll(choices(2), () => new Promise<SaveResult>(() => {}), { timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(done).resolves.toEqual(['r1', 'r2']);
  });
});

describe('T-POOL-3: a refusal with a wait', () => {
  it('T-POOL-3 a refusal with a wait of 60 s or less is retried once after the wait, showing the seconds left', async () => {
    const calls = new Map<string, number>();
    const choose = async (c: SaveChoice): Promise<SaveResult> => {
      const n = (calls.get(c.id) ?? 0) + 1;
      calls.set(c.id, n);
      if (c.id === 'r1' && n === 1) return { ok: false, messageKey: 'review.saveFailed', retryAfterSeconds: 3 };
      return { ok: true };
    };
    const waits: number[] = [];
    const done = saveAll(choices(2), choose, { onWait: (s) => waits.push(s) });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls.get('r1')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toEqual([]);
    expect(calls.get('r1')).toBe(2);
    expect(calls.get('r2')).toBe(1);
    expect(waits).toEqual([3, 2, 1, 0]);
  });

  it('T-POOL-3 a wait over 60 s, a refusal with no wait, or a second refusal fails the row', async () => {
    const calls = new Map<string, number>();
    const choose = async (c: SaveChoice): Promise<SaveResult> => {
      calls.set(c.id, (calls.get(c.id) ?? 0) + 1);
      if (c.id === 'r1') return { ok: false, messageKey: 'review.saveFailed', retryAfterSeconds: 61 };
      if (c.id === 'r2') return { ok: false, messageKey: 'review.saveFailed', retryAfterSeconds: 2 };
      if (c.id === 'r3') return { ok: false, messageKey: 'review.saveFailed' };
      return { ok: true };
    };
    const done = saveAll(choices(4), choose);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(done).resolves.toEqual(['r1', 'r2', 'r3']);
    expect([calls.get('r1'), calls.get('r2'), calls.get('r3'), calls.get('r4')]).toEqual([1, 2, 1, 1]);
  });

  it('T-POOL-3 failures carry ids and counts only: nothing is logged', async () => {
    const log = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const done = saveAll(choices(1), () => Promise.reject(new Error('Comercio Inventado')));
    await vi.advanceTimersByTimeAsync(0);
    await expect(done).resolves.toEqual(['r1']);
    expect([...log.mock.calls, ...warn.mock.calls]).toEqual([]);
  });
});
