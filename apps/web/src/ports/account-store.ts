// The account item (architecture.md Contracts "Accounts table").
export type Consent = { termsVersion: string; privacyVersion: string; lang: 'en' | 'es'; acceptedAt: number };

export type Account = {
  sub: string;
  consent?: Consent;
  status: 'active' | 'deleting';
  deletingSince?: number;
  importsToday?: { day: string; n: number };
  runningImportId?: string;
  /** The bytes reserved with the running import: the file's declared size (owner decision of 2026-11-06). */
  runningImportBytes?: number;
  storedBytes: number;
};

/**
 * What a release gives back besides the slot. giveBackDay is the reservation's UTC day: the row's count for that day goes
 * down by one in the same conditional update, only while the row still counts that day (a request that failed before an
 * upload form went out, owner decision of 2026-11-06).
 */
export type ImportRelease = { giveBackDay?: string };

export type ReserveRefusal = 'daily' | 'bytes' | 'running' | 'deleting';

export interface AccountStore {
  getAccount(sub: string): Promise<Account | undefined>;
  putConsent(sub: string, consent: Consent): Promise<void>;
  /** Conditional: refused while an import runs, a placeholder included, so no import starts during a deletion (AC-18). */
  markDeleting(sub: string, now: number): Promise<{ ok: true } | { ok: false; reason: 'running' }>;
  /**
   * Conditional: refuses past 10 imports a day, 200 MiB stored, while another import runs, or for an account being
   * deleted. The id may be a placeholder, swapped for the data API's import id by confirmImport (D-114).
   */
  reserveImport(sub: string, req: { day: string; bytes: number; importId: string }): Promise<{ ok: true } | { ok: false; reason: ReserveRefusal }>;
  /** Conditional on the placeholder still holding the slot: it becomes the import id, with the same reserved bytes. */
  confirmImport(sub: string, placeholderId: string, importId: string): Promise<boolean>;
  /**
   * Conditional on importId still holding the slot, so it happens once: ends the running import, its reserved bytes
   * replaced by finalBytes (the reserved bytes keep them counted, 0 gives them back), and as release says.
   */
  releaseImport(sub: string, importId: string, finalBytes: number, release?: ImportRelease): Promise<void>;
  resetStoredBytes(sub: string): Promise<void>;
  deleteAccountRow(sub: string): Promise<void>;
}
