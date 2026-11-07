import type { Clock } from '@/ports/clock';
import type { Counter } from '@/ports/counter';

export class MemoryCounter implements Counter {
  private readonly counts = new Map<string, { n: number; expiresAt: number }>();
  constructor(private readonly clock: Clock) {}

  async incr(key: string, windowStart: number, ttl: number) {
    const k = `${key}#${windowStart}`;
    const now = this.clock.now();
    const cur = this.counts.get(k);
    const next = cur && cur.expiresAt > now ? { ...cur, n: cur.n + 1 } : { n: 1, expiresAt: now + ttl };
    this.counts.set(k, next);
    return next.n;
  }
}
