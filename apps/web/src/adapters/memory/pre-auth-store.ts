import type { Clock } from '@/ports/clock';
import type { PreAuthRow, PreAuthStore } from '@/ports/pre-auth-store';

export class MemoryPreAuthStore implements PreAuthStore {
  private readonly rows = new Map<string, PreAuthRow>();
  constructor(private readonly clock: Clock) {}

  private live(idHash: string) {
    const row = this.rows.get(idHash);
    if (row && row.expiresAt <= this.clock.now()) {
      this.rows.delete(idHash);
      return undefined;
    }
    return row;
  }
  async create(row: PreAuthRow) {
    this.rows.set(row.idHash, { ...row });
  }
  async get(idHash: string) {
    const row = this.live(idHash);
    return row && { ...row };
  }
  async update(idHash: string, patch: Partial<Omit<PreAuthRow, 'idHash'>>) {
    const row = this.live(idHash);
    if (!row) return false;
    this.rows.set(idHash, { ...row, ...patch, idHash });
    return true;
  }
  async delete(idHash: string) {
    this.rows.delete(idHash);
  }
}
