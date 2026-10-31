export interface PowStore {
  /** True only the first time a salt is claimed within ttl ms. */
  claim(saltHash: string, ttl: number): Promise<boolean>;
}
