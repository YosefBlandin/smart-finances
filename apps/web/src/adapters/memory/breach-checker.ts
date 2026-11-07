import type { BreachChecker } from '@/ports/breach-checker';

export class MemoryBreachChecker implements BreachChecker {
  private readonly breached = new Set<string>();
  private unavailable = false;
  add(password: string) {
    this.breached.add(password);
  }
  setUnavailable(on: boolean) {
    this.unavailable = on;
  }
  async isBreached(password: string) {
    return this.unavailable ? ('unavailable' as const) : this.breached.has(password);
  }
}
