import type { Clock } from '@/ports/clock';

// A clock tests move by hand.
export class MemoryClock implements Clock {
  constructor(private t = 0) {}
  now() {
    return this.t;
  }
  set(t: number) {
    this.t = t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}
