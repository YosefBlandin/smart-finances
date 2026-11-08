// Delete-all and the quiet window (D-30, architecture.md "States and exits" rows erasing and
// quiet). ERASED is written first, so from that moment no lock, rollup, review choice or rate
// write can land; then every other item of the person and every uploaded file goes; then
// quiet_until is set to the end plus 65 minutes, longer than the stream's 1-hour record age.
// A crash leaves quiet_until unset, so everything stays refused until a repeat call finishes.
import { inEraseWindow, lockLive } from './imports.mjs';
import { erasedKey, PREFIX, personPk, uploadPrefix } from './keys.mjs';
import { ConditionFailed } from './memory.mjs';

export const QUIET_MS = 65 * 60 * 1000;
const REMOVE_PARALLEL = 8;
const iso = (ms) => new Date(ms).toISOString();

async function inPool(items, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(REMOVE_PARALLEL, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// Why an erase cannot start now: a live period lock, or an upload form still open.
function busy(items, now) {
  if (items.some((i) => i.sk.startsWith(PREFIX.PER) && lockLive(i, now))) return 'an import of one of your periods is running';
  if (items.some((i) => i.sk.startsWith(PREFIX.IMP) && i.status === 'requested' && i.expires_at > iso(now))) return 'an upload is still open';
  return undefined;
}

// Outcomes: { deleted: { items, files } } | { conflict: reason }.
export async function eraseAll(store, sub, { now = () => Date.now(), attempt = 0 } = {}) {
  const key = erasedKey(sub);
  const pk = personPk(sub);
  const before = await store.get(key, { consistent: true });
  const start = now();

  // Finished and still quiet: nothing can have been stored since, so there is nothing to delete.
  if (before?.quiet_until && inEraseWindow(before, start)) return { deleted: { items: 0, files: 0 } };

  let marker = before;
  if (!before || before.quiet_until) {
    // A new erase. Mark first, then look for running work: anything that took a lock before the
    // mark is visible now, and nothing can take one after it.
    marker = { ...key, erased_at: iso(start) };
    const same = before ? [{ attr: 'quiet_until', op: '=', value: before.quiet_until }] : [{ attr: 'sk', exists: false }];
    try {
      await store.put(marker, { if: same });
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      if (attempt >= 4) throw err;
      return eraseAll(store, sub, { now, attempt: attempt + 1 }); // another erase moved the marker; decide again
    }
    const { items } = await store.query({ pk, consistent: true });
    const reason = busy(items, now());
    if (reason) {
      // Put the marker back as it was, only if it is still ours.
      const ours = [{ attr: 'erased_at', op: '=', value: marker.erased_at }, { attr: 'quiet_until', exists: false }];
      if (before) await store.put(before, { if: ours });
      else await store.remove(key, { if: ours });
      return { conflict: reason };
    }
  }

  const { items } = await store.query({ pk, consistent: true });
  const doomed = items.filter((i) => i.sk !== key.sk);
  await inPool(doomed, (item) => store.remove(item));
  const files = await store.listKeys(uploadPrefix(sub));
  if (files.length) await store.deleteObjects(files);

  const end = now();
  try {
    await store.put({ ...marker, quiet_until: iso(end + QUIET_MS) }, { if: [{ attr: 'erased_at', op: '=', value: marker.erased_at }, { attr: 'quiet_until', exists: false }] });
  } catch (err) {
    // A concurrent repeat call finished it first; the person's data is gone either way.
    if (!(err instanceof ConditionFailed)) throw err;
  }
  return { deleted: { items: doomed.length, files: files.length } };
}
