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

// The wall clock, for the one STAGE=test container the running app shares across requests (getContainer), so proof-of-work
// answers expire and counter windows move as they do on a real stage.
export class SystemClock implements Clock {
  now() {
    return Date.now();
  }
}
