// A pre-auth item (architecture.md Contracts "Sessions table"): the sign-up, sign-in or reset step in progress.
export type PreAuthRow = {
  idHash: string;
  step: string;
  email: string;
  emailHash: string;
  challengeSession?: string;
  totpSecret?: string;
  acceptedVersions?: { terms: string; privacy: string };
  lang: 'en' | 'es';
  attempts: number;
  expiresAt: number;
};

export interface PreAuthStore {
  create(row: PreAuthRow): Promise<void>;
  get(idHash: string): Promise<PreAuthRow | undefined>;
  /** Applies the patch only if the row still exists; false otherwise. */
  update(idHash: string, patch: Partial<Omit<PreAuthRow, 'idHash'>>): Promise<boolean>;
  delete(idHash: string): Promise<void>;
}
