import type { Account, AccountStore, Consent, ImportRelease } from '@/ports/account-store';

const MiB = 1024 * 1024;
export const IMPORT_LIMITS = { perDay: 10, storedBytes: 200 * MiB };

// Each change is applied whole or not at all, like the real adapter's conditional writes.
export class MemoryAccountStore implements AccountStore {
  private readonly rows = new Map<string, Account>();

  private row(sub: string): Account {
    return this.rows.get(sub) ?? { sub, status: 'active', storedBytes: 0 };
  }
  async getAccount(sub: string) {
    const row = this.rows.get(sub);
    return row && structuredClone(row);
  }
  async putConsent(sub: string, consent: Consent) {
    this.rows.set(sub, { ...this.row(sub), consent: { ...consent } });
  }
  async markDeleting(sub: string, now: number) {
    const row = this.row(sub);
    if (row.runningImportId) return { ok: false as const, reason: 'running' as const };
    this.rows.set(sub, { ...row, status: 'deleting', deletingSince: row.deletingSince ?? now });
    return { ok: true as const };
  }
  async reserveImport(sub: string, { day, bytes, importId }: { day: string; bytes: number; importId: string }) {
    const row = this.row(sub);
    const today = row.importsToday?.day === day ? row.importsToday.n : 0;
    if (row.status === 'deleting') return { ok: false as const, reason: 'deleting' as const };
    if (row.runningImportId) return { ok: false as const, reason: 'running' as const };
    if (today >= IMPORT_LIMITS.perDay) return { ok: false as const, reason: 'daily' as const };
    if (row.storedBytes + bytes > IMPORT_LIMITS.storedBytes) return { ok: false as const, reason: 'bytes' as const };
    this.rows.set(sub, {
      ...row,
      importsToday: { day, n: today + 1 },
      runningImportId: importId,
      runningImportBytes: bytes,
      storedBytes: row.storedBytes + bytes,
    });
    return { ok: true as const };
  }
  async confirmImport(sub: string, placeholderId: string, importId: string) {
    const row = this.rows.get(sub);
    if (!row || row.runningImportId !== placeholderId) return false;
    this.rows.set(sub, { ...row, runningImportId: importId });
    return true;
  }
  async releaseImport(sub: string, importId: string, finalBytes: number, release: ImportRelease = {}) {
    const row = this.rows.get(sub);
    if (!row || row.runningImportId !== importId) return;
    const storedBytes = Math.max(0, row.storedBytes - (row.runningImportBytes ?? 0) + finalBytes);
    const today = row.importsToday;
    const giveBack = release.giveBackDay !== undefined && today?.day === release.giveBackDay && today.n > 0;
    this.rows.set(sub, {
      ...row,
      storedBytes,
      runningImportId: undefined,
      runningImportBytes: undefined,
      ...(giveBack ? { importsToday: { day: today.day, n: today.n - 1 } } : {}),
    });
  }
  async resetStoredBytes(sub: string) {
    const row = this.rows.get(sub);
    if (row) this.rows.set(sub, { ...row, storedBytes: 0 });
  }
  async deleteAccountRow(sub: string) {
    this.rows.delete(sub);
  }
}
