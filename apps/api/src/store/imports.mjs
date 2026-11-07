// The import core (architecture.md "Import record", "States and exits", D-16, D-28, D-30).
// An import record moves requested -> importing under its period's lock, then commits by moving
// the period pointer and reconciles the period's stored rows to the active file's rows.
// Every lock and pointer write is conditional on the pointer's revision and on lock_import being
// this record, so a slow duplicate can never release or move what a later run holds.
import { erasedKey, impKey, perKey, uploadKey } from './keys.mjs';
import { ConditionFailed } from './memory.mjs';
import { ulid as defaultUlid } from './ulid.mjs';

export const FORM_SECONDS = 15 * 60;
export const LOCK_MS = 10 * 60 * 1000;
export const FINAL = new Set(['done', 'unchanged', 'superseded', 'failed']);
const ATTEMPTS = 5;

const iso = (ms) => new Date(ms).toISOString();

// A lost condition, or DynamoDB cancelling two overlapping transactions on one item: read
// again and decide again.
const retryable = (err) => err instanceof ConditionFailed
  || (err?.name === 'TransactionCanceledException' && (err.CancellationReasons ?? []).some((r) => r?.Code === 'TransactionConflict'))
  || err?.name === 'TransactionConflictException';

// One record per upload, undo or repair. period stays '' until the parser knows it (D-39).
export async function createImport(store, sub, { source, file_name, size, now = Date.now(), ulid = defaultUlid }) {
  const import_id = ulid(now);
  const record = {
    ...impKey(sub, import_id),
    import_id,
    kind: 'file',
    source,
    file_name,
    s3_key: uploadKey(sub, import_id),
    size,
    period: '',
    status: 'requested',
    created_at: iso(now),
    expires_at: iso(now + FORM_SECONDS * 1000),
  };
  await store.put(record, { if: [{ attr: 'sk', exists: false }] });
  return record;
}

export const getImport = (store, sub, importId) => store.get(impKey(sub, importId), { consistent: true });
export const getPointer = (store, sub, source, period) => store.get(perKey(sub, source, period), { consistent: true });

// The erase window (D-30): from erased_at until quiet_until, nothing may lock a period.
export function inEraseWindow(marker, now) {
  if (!marker) return false;
  return !marker.quiet_until || marker.quiet_until >= iso(now);
}
export const eraseCheck = (sub, now) => ({
  check: erasedKey(sub),
  if: [{ any: [{ attr: 'erased_at', exists: false }, { attr: 'quiet_until', op: '<', value: iso(now) }] }],
});

// The pointer as stored, or a fresh one. rev counts writes, so every pointer write can be
// conditional on the version that was read.
export function pointerOf(item, sub, source, period) {
  return item ?? { ...perKey(sub, source, period), history: [], rev: 0 };
}
export const revIs = (pointer) => (pointer.rev ? [{ attr: 'rev', op: '=', value: pointer.rev }] : [{ attr: 'sk', exists: false }]);

export const lockLive = (pointer, now) => Boolean(pointer.lock_import && pointer.lock_until && pointer.lock_until > iso(now));

// Ends a record as failed, only while it still has the status that was read; when it holds its
// period's lock, the lock goes in the same transaction. Returns undefined when the record
// changed meanwhile, so the caller reads it again.
async function failRecord(store, sub, record, now, code, message) {
  const failed = { ...record, status: 'failed', finished_at: iso(now), error: { code, message } };
  const ops = [{ put: failed, if: [{ attr: 'status', op: '=', value: record.status }] }];
  const pointer = record.period ? await getPointer(store, sub, record.source, record.period) : undefined;
  if (pointer?.lock_import === record.import_id) {
    const { lock_import: _lock, lock_until: _until, ...rest } = pointer;
    ops.push({ put: { ...rest, rev: (pointer.rev ?? 0) + 1 }, if: [...revIs(pointer), { attr: 'lock_import', op: '=', value: record.import_id }] });
  }
  try {
    await store.transact(ops);
    return failed;
  } catch (err) {
    if (!retryable(err)) throw err;
    return undefined;
  }
}

// The parser takes the period lock for a file import ("States and exits", requested and
// importing). Returns { outcome, record }: locked (requested moved to importing, or a re-entry
// by the record that holds the lock), failed (an expired form, the erase window, a live lock of
// another record, or a period unlike the one this record already locked), ignored (a final
// record, or importing while another run holds a live lock), or missing (no record).
export async function takeLock(store, sub, importId, { period, now = Date.now(), eventTime = now }) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const record = await getImport(store, sub, importId);
    if (!record) return { outcome: 'missing' };
    if (FINAL.has(record.status)) return { outcome: 'ignored', record };
    let refusal;
    if (record.status === 'requested' && iso(eventTime) >= record.expires_at) refusal = ['form_expired', 'The file arrived after its upload form expired.'];
    else if (record.status === 'importing' && record.period && record.period !== period) refusal = ['period_changed', 'The file no longer covers the period it was locked for.'];
    else if (inEraseWindow(await store.get(erasedKey(sub), { consistent: true }), now)) refusal = ['erasing', 'All data is being deleted; upload the file again later.'];
    if (refusal) {
      const failed = await failRecord(store, sub, record, now, ...refusal);
      if (failed) return { outcome: 'failed', record: failed };
      continue;
    }
    const pointer = pointerOf(await getPointer(store, sub, record.source, period), sub, record.source, period);
    if (lockLive(pointer, now) && pointer.lock_import !== importId) {
      if (record.status === 'importing') return { outcome: 'ignored', record };
      const failed = await failRecord(store, sub, record, now, 'period_busy', 'Another import of this period is running; try again in a few minutes.');
      if (failed) return { outcome: 'failed', record: failed };
      continue;
    }
    const importing = { ...record, status: 'importing', period };
    const locked = { ...pointer, lock_import: importId, lock_until: iso(now + LOCK_MS), rev: (pointer.rev ?? 0) + 1 };
    try {
      await store.transact([
        { put: importing, if: [{ attr: 'status', op: '=', value: record.status }] },
        { put: locked, if: revIs(pointer) },
        eraseCheck(sub, now),
      ]);
      return { outcome: 'locked', record: importing, pointer: locked };
    } catch (err) {
      if (!retryable(err)) throw err;
      // Someone else wrote first: read again and decide again.
    }
  }
  throw new Error('takeLock: too much contention');
}

// ---- commit and reconcile (D-28, D-32) ----
import { findPossibleDuplicates } from '../ingest/reconcile.mjs';
import { FIELDS } from '../ingest/schema.mjs';
import { monthRange, PREFIX, personPk, txnKey } from './keys.mjs';

const PUT_PARALLEL = 8;

async function inPool(items, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(PUT_PARALLEL, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// The pointer without its lock, one revision on.
const released = (pointer) => {
  const { lock_import: _lock, lock_until: _until, ...rest } = pointer;
  return { ...rest, rev: (pointer.rev ?? 0) + 1 };
};
const holds = (pointer, id) => [...revIs(pointer), { attr: 'lock_import', op: '=', value: id }];

// Commit moves the period pointer to this import before any row is written ("States and
// exits", importing). Outcomes: committed (also when this import is already active, a retry),
// unchanged (same content as the active import: nothing moves, the reconcile still runs),
// superseded (a newer import is already active: the lock is released), lost_lock (another run
// holds the lock now), ignored (the record is final).
export async function commitImport(store, sub, importId, { content_hash, now = Date.now() }) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const record = await getImport(store, sub, importId);
    if (!record || FINAL.has(record.status)) return { outcome: 'ignored', record };
    if (record.status !== 'importing') throw new Error(`commit of an import that is ${record.status}`);
    const pointer = await getPointer(store, sub, record.source, record.period);
    if (!pointer || pointer.lock_import !== importId) return { outcome: 'lost_lock', record };
    if (pointer.active_import === importId) return { outcome: 'committed', record, pointer };
    const active = pointer.active_import ? await getImport(store, sub, pointer.active_import) : undefined;
    const statusIs = [{ attr: 'status', op: '=', value: 'importing' }];
    try {
      if (active && active.content_hash === content_hash) {
        const same = { ...record, content_hash };
        await store.transact([{ put: same, if: statusIs }, { check: pointer, if: holds(pointer, importId) }]);
        return { outcome: 'unchanged', record: same, pointer };
      }
      if (active && active.import_id > importId) {
        const superseded = { ...record, content_hash, status: 'superseded', finished_at: iso(now) };
        await store.transact([{ put: superseded, if: statusIs }, { put: released(pointer), if: holds(pointer, importId) }]);
        return { outcome: 'superseded', record: superseded };
      }
      const committed = { ...record, content_hash, replaces: active ? active.import_id : 'none' };
      const moved = {
        ...pointer,
        active_import: importId,
        history: [...(pointer.history ?? []).filter((id) => id !== importId), importId],
        rev: (pointer.rev ?? 0) + 1,
      };
      await store.transact([{ put: committed, if: statusIs }, { put: moved, if: holds(pointer, importId) }]);
      return { outcome: 'committed', record: committed, pointer: moved };
    } catch (err) {
      if (!retryable(err)) throw err;
    }
  }
  throw new Error('commitImport: too much contention');
}

// The stored transactions of one source and period (D-32): a month period reads only its own
// month's range, a log period reads every transaction; both filter on source (and log on period).
async function storedRows(store, sub, source, period) {
  const pk = personPk(sub);
  const { items } = period === 'log'
    ? await store.query({ pk, prefix: PREFIX.TXN, consistent: true })
    : await store.query({ pk, between: monthRange(PREFIX.TXN, period, period), consistent: true });
  return items.filter((i) => i.source === source && (period !== 'log' || i.period === 'log'));
}

// Stored rows of other files dated on the days a file's issues name, so a twin uploaded
// earlier is still found (architecture.md "Importers").
async function twinCandidates(store, sub, issues, source, period) {
  const days = [...new Set(issues.filter((i) => i.statedDate).map((i) => i.statedDate))];
  const found = [];
  for (const day of days) {
    const { items } = await store.query({ pk: personPk(sub), prefix: `${PREFIX.TXN}${day}#`, consistent: true });
    found.push(...items.filter((i) => !(i.source === source && i.period === period)));
  }
  return found;
}

const sameRow = (a, b) => FIELDS.every((f) => JSON.stringify(a[f]) === JSON.stringify(b[f]));

// Makes the period's stored rows equal to its active file's rows (Contracts "Parser input").
// load(record) returns that import's parsed { transactions, issues }. Running it again gives
// the same rows. Only the record that holds the period's lock may reconcile.
export async function reconcile(store, sub, runningId, { now = Date.now(), load }) {
  const running = await getImport(store, sub, runningId);
  if (!running) return { outcome: 'missing' };
  const { source, period } = running;
  const pointer = await getPointer(store, sub, source, period);
  if (!pointer || pointer.lock_import !== runningId) return { outcome: 'lost_lock' };
  const active = pointer.active_import ? await getImport(store, sub, pointer.active_import) : undefined;
  const parsed = active ? await load(active) : { transactions: [], issues: [] };
  const rows = parsed.transactions.map((t) => ({ ...t, flags: [...(t.flags ?? [])] }));

  findPossibleDuplicates(parsed.issues ?? [], [...rows, ...(await twinCandidates(store, sub, parsed.issues ?? [], source, period))]);

  const before = new Map((await storedRows(store, sub, source, period)).map((i) => [i.sk, i]));
  const items = rows.map((t) => ({ ...txnKey(sub, t.date, t.id), ...t, period, import_id: active.import_id }));
  const keep = new Set(items.map((i) => i.sk));
  const counts = { added: 0, updated: 0, removed: 0, skipped: running.counts?.skipped ?? running.skipped?.length ?? 0 };
  for (const item of items) {
    const old = before.get(item.sk);
    if (!old) counts.added += 1;
    else if (!sameRow(old, item)) counts.updated += 1;
  }
  await inPool(items, (item) => store.put(item));
  const gone = [...before.values()].filter((i) => !keep.has(i.sk));
  counts.removed = gone.length;
  await inPool(gone, (item) => store.remove(item));

  // Final marks, then the lock goes. A crash before the release leaves the lock to expire.
  const finished = iso(now);
  const unchanged = active && running.kind === 'file' && running.import_id !== active.import_id && running.content_hash === active.content_hash;
  if (active && active.import_id !== runningId && active.status !== 'done') {
    await store.put({ ...active, status: 'done', finished_at: active.finished_at ?? finished });
  }
  await store.put({ ...running, status: unchanged ? 'unchanged' : 'done', finished_at: finished, counts });
  const { items: imports } = await store.query({ pk: personPk(sub), prefix: PREFIX.IMP, consistent: true });
  for (const other of imports) {
    if (other.source !== source || other.period !== period || other.import_id >= runningId || other.import_id === active?.import_id) continue;
    if (other.status !== 'requested' && other.status !== 'importing') continue;
    try {
      await store.put({ ...other, status: 'superseded', finished_at: finished }, { if: [{ attr: 'status', op: '=', value: other.status }] });
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
    }
  }
  const latest = await getPointer(store, sub, source, period);
  try {
    if (latest?.lock_import === runningId) await store.put(released(latest), { if: holds(latest, runningId) });
  } catch (err) {
    if (!(err instanceof ConditionFailed)) throw err;
  }
  return { outcome: 'done', counts };
}
