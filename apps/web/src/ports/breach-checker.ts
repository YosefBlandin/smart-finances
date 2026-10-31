export interface BreachChecker {
  /** The range check (D-117); 'unavailable' when the service cannot answer. */
  isBreached(password: string): Promise<boolean | 'unavailable'>;
}
