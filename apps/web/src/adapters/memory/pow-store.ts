import type { Clock } from '@/ports/clock';
import type { PowStore } from '@/ports/pow-store';

export class MemoryPowStore implements PowStore {
  private readonly claimed = new Map<string, number>();
  constructor(private readonly clock: Clock) {}

  async claim(saltHash: string, ttl: number) {
    const now = this.clock.now();
    const until = this.claimed.get(saltHash);
    if (until !== undefined && until > now) return false;
    this.claimed.set(saltHash, now + ttl);
    return true;
  }
}
