/* eslint-disable import/no-restricted-paths -- T-WSCR-8 drives the import use cases over the memory adapters (the
   STAGE=test container); no production application code imports adapters. */
import { describe, expect, it } from 'vitest';
import { memoryContainer, type Container } from '@/adapters/container';
import { MemoryClock } from '@/adapters/memory/clock';
import type { MemoryDataApi } from '@/adapters/memory/data-api';
import type { MemoryParameterStore } from '@/adapters/memory/parameter-store';
import type { ParameterStore } from '@/ports/parameter-store';
import { createImports, IMPORT_RUN_MS, PAUSE_PARAMETER, PENDING_IMPORT, PENDING_STALE_MS } from './requestImport';

// T-WSCR-8 (AC-17, D-114, D-96): an import request checks the name and size with the contracts' SOURCES, then the
// pause switch, then reserves one slot on the account row (10 a UTC day, one running, 200 MiB stored counting the
// source's maximum); the slot is released or corrected when the import reaches its final status. Memory adapters,
// synthetic people and files only.

const MiB = 1024 * 1024;
const DAY = 24 * 60 * 60_000;
const START = Date.UTC(2026, 10, 5, 12, 0, 0);
const SUB = 'import-person-sub';
const WHO = { sub: SUB, accessToken: 'import-person-token' };
const CSV = { source: 'mercadopago', fileName: 'release-report-2026-10.csv', size: 1_200 };

function setup() {
  const clock = new MemoryClock(START);
  const c: Container = memoryContainer(undefined, clock);
  (c.dataApi as MemoryDataApi).allowToken(WHO.accessToken);
  const calls: string[] = [];
  const api = c.dataApi as MemoryDataApi;
  const requestImport = api.requestImport.bind(api);
  api.requestImport = async (token, input) => {
    calls.push(input.file_name);
    return requestImport(token, input);
  };
  return { c, clock, imports: createImports(c), calls };
}

/** Lets the memory import finish, then reads it, as the screen's polling does. */
async function finish(s: ReturnType<typeof setup>, importId: string) {
  s.clock.advance(IMPORT_RUN_MS);
  const read = await s.imports.getImport(WHO, importId);
  if (!read.ok) throw new Error('read failed');
  return read.data;
}

describe('T-WSCR-8: import caps (D-114)', () => {
  it('T-WSCR-8: five parallel import requests reserve exactly one slot', async () => {
    const s = setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => s.imports.requestImport(WHO, CSV)));
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.reason))).toEqual(['running', 'running', 'running', 'running']);
    const account = await s.c.accountStore.getAccount(SUB);
    expect(account?.importsToday).toEqual({ day: '2026-11-05', n: 1 });
    expect(account?.runningImportId).toBe(ok[0]!.ok ? ok[0]!.data.importId : '');
    // The reservation counts the source's maximum (5 MiB for a CSV), not the size the browser reported.
    expect(account?.storedBytes).toBe(5 * MiB);
    // The slot is reserved before the data API is asked, so only the winner asks it.
    expect(s.calls).toHaveLength(1);
  });

  it('T-WSCR-8: the slot is reserved under a placeholder before POST /imports, then swapped to the import id', async () => {
    const s = setup();
    const api = s.c.dataApi as MemoryDataApi;
    const ask = api.requestImport.bind(api);
    let during: string | undefined;
    api.requestImport = async (token, input) => {
      during = (await s.c.accountStore.getAccount(SUB))?.runningImportId;
      return ask(token, input);
    };
    const started = await s.imports.requestImport(WHO, CSV);
    if (!started.ok) throw new Error('refused');
    expect(during?.startsWith(PENDING_IMPORT)).toBe(true);
    expect((await s.c.accountStore.getAccount(SUB))?.runningImportId).toBe(started.data.importId);
    // The release at the final status finds the slot by the import id, with the reserved bytes.
    await finish(s, started.data.importId);
    expect(await s.c.accountStore.getAccount(SUB)).toMatchObject({ runningImportId: undefined, storedBytes: 5 * MiB });
  });

  it('T-WSCR-8: a refused or failed POST /imports releases the placeholder and its bytes', async () => {
    const s = setup();
    const api = s.c.dataApi as MemoryDataApi;
    const ask = api.requestImport.bind(api);
    api.requestImport = async () => ({ ok: false, kind: 'failed', code: 'timeout' });
    expect(await s.imports.requestImport(WHO, CSV)).toMatchObject({ ok: false, reason: 'failed' });
    expect(await s.c.accountStore.getAccount(SUB)).toMatchObject({ runningImportId: undefined, storedBytes: 0 });
    api.requestImport = async () => Promise.reject(new Error('the data API is unreachable'));
    await expect(s.imports.requestImport(WHO, CSV)).rejects.toThrow('unreachable');
    expect(await s.c.accountStore.getAccount(SUB)).toMatchObject({ runningImportId: undefined, storedBytes: 0 });
    api.requestImport = ask;
    expect((await s.imports.requestImport(WHO, CSV)).ok).toBe(true);
  });

  it('T-WSCR-8: a placeholder on the row counts as running; one left past its time is released', async () => {
    const s = setup();
    const placeholder = `${PENDING_IMPORT}${START}:left-by-a-request-that-stopped`;
    await s.c.accountStore.reserveImport(SUB, { day: '2026-11-05', bytes: 5 * MiB, importId: placeholder });
    expect(await s.imports.requestImport(WHO, CSV)).toMatchObject({ ok: false, reason: 'running' });
    expect(s.calls).toEqual([]);
    s.clock.advance(PENDING_STALE_MS);
    expect((await s.imports.requestImport(WHO, CSV)).ok).toBe(true);
    // The stopped request never handed out an upload form, so its bytes came back.
    expect((await s.c.accountStore.getAccount(SUB))?.storedBytes).toBe(5 * MiB);
  });

  it('T-WSCR-8: confirmImport swaps only its own placeholder (memory adapter)', async () => {
    const s = setup();
    await s.c.accountStore.reserveImport(SUB, { day: '2026-11-05', bytes: MiB, importId: 'pending:1:a' });
    expect(await s.c.accountStore.confirmImport(SUB, 'pending:1:b', 'imp-b')).toBe(false);
    expect((await s.c.accountStore.getAccount(SUB))?.runningImportId).toBe('pending:1:a');
    expect(await s.c.accountStore.confirmImport(SUB, 'pending:1:a', 'imp-a')).toBe(true);
    await s.c.accountStore.releaseImport(SUB, 'imp-a', 2 * MiB);
    expect(await s.c.accountStore.getAccount(SUB)).toMatchObject({ runningImportId: undefined, storedBytes: 2 * MiB });
  });

  it('T-WSCR-8: an account being deleted reserves no import (AC-18)', async () => {
    const s = setup();
    expect(await s.c.accountStore.markDeleting(SUB, START)).toEqual({ ok: true });
    expect(await s.c.accountStore.reserveImport(SUB, { day: '2026-11-05', bytes: 1, importId: 'imp-x' })).toEqual({ ok: false, reason: 'deleting' });
    expect(await s.imports.requestImport(WHO, CSV)).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(s.calls).toEqual([]);
    expect((await s.c.accountStore.getAccount(SUB))?.runningImportId).toBeUndefined();
  });

  it('T-WSCR-8: the slot is released at the final status, and the next import may start', async () => {
    const s = setup();
    const first = await s.imports.requestImport(WHO, CSV);
    if (!first.ok) throw new Error('refused');
    expect(first.data.upload.url).toMatch(/^https:\/\//);
    // Still running: not released, and a second request waits.
    const running = await s.imports.getImport(WHO, first.data.importId);
    expect(running.ok && running.data.status).toBe('importing');
    expect((await s.c.accountStore.getAccount(SUB))?.runningImportId).toBe(first.data.importId);
    expect(await s.imports.requestImport(WHO, CSV)).toMatchObject({ ok: false, reason: 'running' });

    const done = await finish(s, first.data.importId);
    expect(done.status).toBe('done');
    const account = await s.c.accountStore.getAccount(SUB);
    expect(account?.runningImportId).toBeUndefined();
    // The web server never learns the stored size, so the source's maximum stays counted (corrected only when no file arrived).
    expect(account?.storedBytes).toBe(5 * MiB);
    expect((await s.imports.requestImport(WHO, CSV)).ok).toBe(true);
  });

  it('T-WSCR-8: an import whose file never arrived gives its bytes back', async () => {
    const s = setup();
    const api = s.c.dataApi as MemoryDataApi;
    api.seed({
      imports: [
        {
          import_id: 'imp-never',
          kind: 'file',
          source: 'excel',
          file_name: 'budget_May_2026.xlsx',
          period: '2026-05',
          status: 'expired',
          created_at: '2026-11-05T11:00:00Z',
          active: false,
        },
      ],
    });
    await s.c.accountStore.reserveImport(SUB, { day: '2026-11-05', bytes: 20 * MiB, importId: 'imp-never' });
    const read = await s.imports.getImport(WHO, 'imp-never');
    expect(read.ok && read.data.status).toBe('expired');
    const account = await s.c.accountStore.getAccount(SUB);
    expect(account?.runningImportId).toBeUndefined();
    expect(account?.storedBytes).toBe(0);
  });

  it('T-WSCR-8: a stalled import frees the slot, keeping the source maximum, and the next import may start', async () => {
    const s = setup();
    const api = s.c.dataApi as MemoryDataApi;
    api.seed({
      imports: [
        {
          import_id: 'imp-stalled',
          kind: 'file',
          source: 'mercadopago',
          file_name: 'release-report-2026-09.csv',
          period: '2026-09',
          status: 'stalled',
          created_at: '2026-11-05T11:00:00Z',
          active: false,
        },
      ],
    });
    await s.c.accountStore.reserveImport(SUB, { day: '2026-11-05', bytes: 5 * MiB, importId: 'imp-stalled' });
    // Nobody watched it: the next request settles it (the data spec's lock frees itself; repair or upload again).
    const next = await s.imports.requestImport(WHO, CSV);
    expect(next.ok).toBe(true);
    // The stalled file stays counted at its source's maximum, like any import whose file arrived.
    expect((await s.c.accountStore.getAccount(SUB))?.storedBytes).toBe(10 * MiB);
  });

  it('T-WSCR-8: reading a stalled import releases its slot', async () => {
    const s = setup();
    const api = s.c.dataApi as MemoryDataApi;
    api.seed({
      imports: [
        {
          import_id: 'imp-stalled',
          kind: 'file',
          source: 'excel',
          file_name: 'budget_Sep_2026.xlsx',
          period: '2026-09',
          status: 'stalled',
          created_at: '2026-11-05T11:00:00Z',
          active: false,
        },
      ],
    });
    await s.c.accountStore.reserveImport(SUB, { day: '2026-11-05', bytes: 20 * MiB, importId: 'imp-stalled' });
    const read = await s.imports.getImport(WHO, 'imp-stalled');
    expect(read.ok && read.data.status).toBe('stalled');
    const account = await s.c.accountStore.getAccount(SUB);
    expect(account?.runningImportId).toBeUndefined();
    expect(account?.storedBytes).toBe(20 * MiB);
  });

  it('T-WSCR-8: a running slot left by a finished import is settled by the next request', async () => {
    const s = setup();
    const first = await s.imports.requestImport(WHO, CSV);
    if (!first.ok) throw new Error('refused');
    // The page was closed: nobody read the import to its end.
    s.clock.advance(IMPORT_RUN_MS);
    const second = await s.imports.requestImport(WHO, CSV);
    expect(second.ok).toBe(true);
    expect((await s.c.accountStore.getAccount(SUB))?.importsToday).toEqual({ day: '2026-11-05', n: 2 });
  });

  it('T-WSCR-8: ten imports a UTC day, then a plain refusal until the next day', async () => {
    const s = setup();
    for (let i = 0; i < 10; i += 1) {
      const r = await s.imports.requestImport(WHO, CSV);
      if (!r.ok) throw new Error(`refused at ${i}: ${r.reason}`);
      await finish(s, r.data.importId);
    }
    const calls = s.calls.length;
    expect(await s.imports.requestImport(WHO, CSV)).toMatchObject({ ok: false, reason: 'daily' });
    expect(s.calls).toHaveLength(calls); // refused before the data API is asked
    s.clock.set(Date.UTC(2026, 10, 6, 0, 0, 1));
    expect((await s.imports.requestImport(WHO, CSV)).ok).toBe(true);
    expect((await s.c.accountStore.getAccount(SUB))?.importsToday).toEqual({ day: '2026-11-06', n: 1 });
  });

  it("T-WSCR-8: stored bytes plus the source's maximum must stay within 200 MiB", async () => {
    const s = setup();
    await s.c.accountStore.reserveImport(SUB, { day: '2026-11-01', bytes: 0, importId: 'old' });
    await s.c.accountStore.releaseImport(SUB, 'old', 190 * MiB);
    // An excel file counts its 20 MiB maximum, however small it is.
    expect(await s.imports.requestImport(WHO, { source: 'excel', fileName: 'budget_Oct_2026.xlsx', size: 10 })).toMatchObject({
      ok: false,
      reason: 'bytes',
    });
    expect((await s.imports.requestImport(WHO, CSV)).ok).toBe(true);
    expect(s.clock.now()).toBeLessThan(START + DAY);
  });

  it('T-WSCR-8: the name and size are checked with the contracts before anything is reserved or sent', async () => {
    const s = setup();
    expect(await s.imports.requestImport(WHO, { source: 'excel', fileName: 'budget.xlsx', size: 10 })).toMatchObject({ ok: false, reason: 'name' });
    expect(await s.imports.requestImport(WHO, { source: 'excel', fileName: 'budget_Oct_2026.xlsx', size: 21 * MiB })).toMatchObject({
      ok: false,
      reason: 'too_large',
    });
    expect(await s.imports.requestImport(WHO, { source: 'notion', fileName: 'notes.md', size: 0 })).toMatchObject({ ok: false, reason: 'empty' });
    expect(await s.imports.requestImport(WHO, { source: 'bank', fileName: 'x.csv', size: 10 })).toMatchObject({ ok: false, reason: 'source' });
    expect(s.calls).toEqual([]);
    expect(await s.c.accountStore.getAccount(SUB)).toBeUndefined();
  });

  it('T-WSCR-8: the pause switch ("true") refuses new imports; a switch that cannot be read refuses too', async () => {
    const s = setup();
    (s.c.parameterStore as MemoryParameterStore).set(PAUSE_PARAMETER('test'), 'true');
    expect(await s.imports.requestImport(WHO, CSV)).toMatchObject({ ok: false, reason: 'paused' });
    (s.c.parameterStore as MemoryParameterStore).set(PAUSE_PARAMETER('test'), 'false');
    expect((await s.imports.requestImport(WHO, CSV)).ok).toBe(true);

    const t = setup();
    const broken: ParameterStore = { get: async () => Promise.reject(new Error('unreadable')) };
    const imports = createImports({ ...t.c, parameterStore: broken });
    expect(await imports.requestImport(WHO, CSV)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(t.calls).toEqual([]);
    expect(await t.c.accountStore.getAccount(SUB)).toBeUndefined();
  });
});
