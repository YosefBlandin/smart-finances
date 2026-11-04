export interface BreachChecker {
  /**
   * The range check (D-117); 'unavailable' when the service cannot answer. On 'unavailable' the caller accepts the
   * password and logs breach_check_unavailable with its request id; the checker itself logs nothing.
   */
  isBreached(password: string): Promise<boolean | 'unavailable'>;
}
