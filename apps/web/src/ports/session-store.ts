// A session item (architecture.md Contracts "Sessions table"). idHash is the sha256 of the cookie value.
export type SessionRow = {
  idHash: string;
  sub: string;
  accessToken: string;
  idToken: string;
  refreshToken: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

export interface SessionStore {
  create(row: SessionRow): Promise<void>;
  get(idHash: string): Promise<SessionRow | undefined>;
  /** Updates lastSeenAt only if the row still exists; false otherwise. */
  touch(idHash: string, now: number): Promise<boolean>;
  delete(idHash: string): Promise<void>;
  listBySub(sub: string): Promise<SessionRow[]>;
  /** Returns how many sessions were removed. */
  deleteBySub(sub: string): Promise<number>;
}
