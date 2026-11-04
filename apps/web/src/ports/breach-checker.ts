export interface BreachChecker {
  /**
   * The range check (D-117): true when the password is breached. 'unavailable' when the service cannot answer; the
   * checker has then logged breach_check_unavailable with this context, and the caller accepts the password. The
   * breached_password event is the caller's.
   */
  isBreached(password: string, context: { sub?: string; requestId: string }): Promise<boolean | 'unavailable'>;
}
