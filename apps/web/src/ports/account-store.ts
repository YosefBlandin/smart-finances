// The account item (architecture.md Contracts "Accounts table").
export type Consent = { termsVersion: string; privacyVersion: string; lang: 'en' | 'es'; acceptedAt: number };

export type Account = {
  sub: string;
  consent?: Consent;
  status: 'active' | 'deleting';
  deletingSince?: number;
  importsToday?: { day: string; n: number };
  runningImportId?: string;
  storedBytes: number;
};

export type ReserveRefusal = 'daily' | 'bytes' | 'running';

export interface AccountStore {
  getAccount(sub: string): Promise<Account | undefined>;
  putConsent(sub: string, consent: Consent): Promise<void>;
  markDeleting(sub: string, now: number): Promise<void>;
  /** Conditional: refuses past 10 imports a day, 200 MiB stored, or while another import runs. */
  reserveImport(sub: string, req: { day: string; bytes: number; importId: string }): Promise<{ ok: true } | { ok: false; reason: ReserveRefusal }>;
  releaseImport(sub: string, importId: string, finalBytes: number): Promise<void>;
  resetStoredBytes(sub: string): Promise<void>;
  deleteAccountRow(sub: string): Promise<void>;
}
