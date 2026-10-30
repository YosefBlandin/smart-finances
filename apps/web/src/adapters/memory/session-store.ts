import type { Clock } from '@/ports/clock';
import type { SessionRow, SessionStore } from '@/ports/session-store';

// Expired rows read as missing, as DynamoDB TTL rows are filtered by the real adapter.
export class MemorySessionStore implements SessionStore {
  private readonly rows = new Map<string, SessionRow>();
  constructor(private readonly clock: Clock) {}

  private live(idHash: string) {
    const row = this.rows.get(idHash);
    if (row && row.expiresAt <= this.clock.now()) {
      this.rows.delete(idHash);
      return undefined;
    }
    return row;
  }
  async create(row: SessionRow) {
    this.rows.set(row.idHash, { ...row });
  }
  async get(idHash: string) {
    const row = this.live(idHash);
    return row && { ...row };
  }
  async touch(idHash: string, now: number) {
    const row = this.live(idHash);
    if (!row) return false;
    row.lastSeenAt = now;
    return true;
  }
  async delete(idHash: string) {
    this.rows.delete(idHash);
  }
  async listBySub(sub: string) {
    return [...this.rows.keys()]
      .map((k) => this.live(k))
      .filter((r): r is SessionRow => r?.sub === sub)
      .map((r) => ({ ...r }));
  }
  async deleteBySub(sub: string) {
    const mine = await this.listBySub(sub);
    for (const r of mine) this.rows.delete(r.idHash);
    return mine.length;
  }
}
