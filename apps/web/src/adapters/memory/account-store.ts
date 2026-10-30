import type { Account, AccountStore, Consent } from '@/ports/account-store';

const MiB = 1024 * 1024;
export const IMPORT_LIMITS = { perDay: 10, storedBytes: 200 * MiB };

// Each change is applied whole or not at all, like the real adapter's conditional writes.
export class MemoryAccountStore implements AccountStore {
  private readonly rows = new Map<string, Account>();
  private readonly reserved = new Map<string, number>();

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
    this.rows.set(sub, { ...this.row(sub), status: 'deleting', deletingSince: now });
  }
  async reserveImport(sub: string, { day, bytes, importId }: { day: string; bytes: number; importId: string }) {
    const row = this.row(sub);
    const today = row.importsToday?.day === day ? row.importsToday.n : 0;
    if (row.runningImportId) return { ok: false as const, reason: 'running' as const };
    if (today >= IMPORT_LIMITS.perDay) return { ok: false as const, reason: 'daily' as const };
    if (row.storedBytes + bytes > IMPORT_LIMITS.storedBytes) return { ok: false as const, reason: 'bytes' as const };
    this.rows.set(sub, { ...row, importsToday: { day, n: today + 1 }, runningImportId: importId, storedBytes: row.storedBytes + bytes });
    this.reserved.set(`${sub}#${importId}`, bytes);
    return { ok: true as const };
  }
  async releaseImport(sub: string, importId: string, finalBytes: number) {
    const row = this.rows.get(sub);
    const key = `${sub}#${importId}`;
    if (!row || !this.reserved.has(key)) return;
    const storedBytes = Math.max(0, row.storedBytes - (this.reserved.get(key) ?? 0) + finalBytes);
    this.reserved.delete(key);
    this.rows.set(sub, { ...row, storedBytes, runningImportId: row.runningImportId === importId ? undefined : row.runningImportId });
  }
  async resetStoredBytes(sub: string) {
    const row = this.rows.get(sub);
    if (row) this.rows.set(sub, { ...row, storedBytes: 0 });
  }
  async deleteAccountRow(sub: string) {
    this.rows.delete(sub);
  }
}
