export interface Counter {
  /** Adds one to the count for key in the window that starts at windowStart, and returns the new count. ttl is in ms. */
  incr(key: string, windowStart: number, ttl: number): Promise<number>;
}
