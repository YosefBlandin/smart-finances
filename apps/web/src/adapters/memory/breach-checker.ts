import type { BreachChecker } from '@/ports/breach-checker';
import type { Logger } from '@/ports/logger';

// Breached passwords are added by hand; when unavailable it logs breach_check_unavailable like the real checker.
export class MemoryBreachChecker implements BreachChecker {
  private readonly breached = new Set<string>();
  private unavailable = false;
  constructor(private readonly logger?: Logger) {}
  add(password: string) {
    this.breached.add(password);
  }
  setUnavailable(on: boolean) {
    this.unavailable = on;
  }
  async isBreached(password: string, context: { sub?: string; requestId: string }) {
    if (this.unavailable) {
      this.logger?.event('breach_check_unavailable', 'unavailable', context);
      return 'unavailable' as const;
    }
    return this.breached.has(password);
  }
}
