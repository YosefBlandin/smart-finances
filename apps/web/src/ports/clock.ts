// Times everywhere are epoch milliseconds from this port.
export interface Clock {
  now(): number;
}
