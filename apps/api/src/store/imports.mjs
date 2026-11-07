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

// Ends a record as failed, only while it still has the status that was read.
async function failRecord(store, record, now, code, message) {
  const failed = { ...record, status: 'failed', finished_at: iso(now), error: { code, message } };
  try {
    await store.put(failed, { if: [{ attr: 'status', op: '=', value: record.status }] });
  } catch (err) {
    if (!(err instanceof ConditionFailed)) throw err;
  }
  return failed;
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
    if (record.status === 'requested' && iso(eventTime) > record.expires_at) {
      return { outcome: 'failed', record: await failRecord(store, record, now, 'form_expired', 'The file arrived after its upload form expired.') };
    }
    if (record.status === 'importing' && record.period && record.period !== period) {
      return { outcome: 'failed', record: await failRecord(store, record, now, 'period_changed', 'The file no longer covers the period it was locked for.') };
    }
    if (inEraseWindow(await store.get(erasedKey(sub), { consistent: true }), now)) {
      return { outcome: 'failed', record: await failRecord(store, record, now, 'erasing', 'All data is being deleted; upload the file again later.') };
    }
    const pointer = pointerOf(await getPointer(store, sub, record.source, period), sub, record.source, period);
    if (lockLive(pointer, now) && pointer.lock_import !== importId) {
      if (record.status === 'importing') return { outcome: 'ignored', record };
      return { outcome: 'failed', record: await failRecord(store, record, now, 'period_busy', 'Another import of this period is running; try again in a few minutes.') };
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
      if (!(err instanceof ConditionFailed)) throw err;
      // Someone else wrote first: read again and decide again.
    }
  }
  throw new Error('takeLock: too much contention');
}
