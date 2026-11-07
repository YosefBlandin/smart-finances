// The rollup (architecture.md Contracts "Rollup", D-14): stream batches (keys only) and the
// rebuild invoke { sub, months: "all" }. Each touched person and month is recomputed once per
// batch. Keys other than TXN# and OVR# are ignored. An unexpected error throws, so the stream
// source bisects and retries the batch, then sends it to the on-failure queue.
import { createRepo } from '../store/repo.mjs';
import { monthsWithData, recomputeMonth } from '../store/totals.mjs';

const ROW_KEY = /^(TXN|OVR)#(\d{4}-\d{2})-\d{2}#/;

// "<sub>\u0000<month>" for every TXN or OVR key in the batch.
function touched(records) {
  const pairs = new Set();
  for (const r of records) {
    const pk = r?.dynamodb?.Keys?.pk?.S;
    const sk = r?.dynamodb?.Keys?.sk?.S;
    const m = typeof sk === 'string' ? ROW_KEY.exec(sk) : null;
    if (!m || typeof pk !== 'string' || !pk.startsWith('U#') || pk.length < 3) continue;
    pairs.add(`${pk.slice(2)}\u0000${m[2]}`);
  }
  return [...pairs].map((p) => p.split('\u0000'));
}

export function createRollupHandler({ store, now = () => Date.now() } = {}) {
  return async (event) => {
    store ??= createRepo();
    if (Array.isArray(event?.Records)) {
      let written = 0;
      let skipped = 0;
      for (const [sub, month] of touched(event.Records)) {
        const out = await recomputeMonth(store, sub, month, { now: now() });
        if (out.skipped) skipped += 1;
        else written += 1;
      }
      console.log(JSON.stringify({ msg: 'rollup', mode: 'stream', records: event.Records.length, written, skipped }));
      return undefined;
    }
    if (typeof event?.sub === 'string' && event.sub && event.months === 'all') {
      const months = await monthsWithData(store, event.sub);
      let skipped = 0;
      for (const month of months) if ((await recomputeMonth(store, event.sub, month, { now: now() })).skipped) skipped += 1;
      console.log(JSON.stringify({ msg: 'rollup', mode: 'rebuild', months: months.length, skipped }));
      return { months: months.length };
    }
    throw new Error('unexpected rollup input');
  };
}

export const handler = createRollupHandler();
