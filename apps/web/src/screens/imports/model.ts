import { checkImportRequest, SOURCES } from '@smart-finances/contracts/routes';
import type { useTranslations } from 'next-intl';
import type { ImportRecord, ImportsPage } from '@/queries/keys';
import type { ChipTone } from '@/ui/primitives/Chip/Chip';
import { monthName } from '../overview/text';

// The Imports screen's plain logic (SF-167): the sources a person picks from, the same name and size check the API makes
// (the contracts' checkImportRequest), the message for each refusal, and the status tones. No 'use client': the import
// server action words its refusals with refusalKey too.

export type ImportItem = ImportsPage['items'][number];

/** The sources offered on screen, in the data spec's order (POST /imports; "csv" is the API's generic name for CSV). */
export const SOURCE_IDS = ['mercadopago', 'notion', 'excel'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/** Why an import cannot start, as the import use case and the browser's own check say it. */
export type ImportReason =
  | 'source'
  | 'empty'
  | 'name'
  | 'too_large'
  | 'paused'
  | 'unavailable'
  | 'daily'
  | 'bytes'
  | 'running'
  | 'conflict'
  | 'limited'
  | 'unauthorized'
  | 'failed';

/** The browser's check of a chosen file before anything is asked or sent: the contracts' rule for the source. */
export function fileRefusal(source: string, file: { name: string; size: number }): ImportReason | undefined {
  if (!Object.hasOwn(SOURCES, source)) return 'source';
  const check = checkImportRequest({ source, file_name: file.name, size: file.size });
  if (check.ok) return undefined;
  if (check.code === 'too_large') return 'too_large';
  return Number.isInteger(file.size) && file.size >= 1 ? 'name' : 'empty';
}

const KEYS: Record<ImportReason, string> = {
  source: 'imports.refused.source',
  empty: 'imports.refused.empty',
  name: 'imports.refused.name',
  too_large: 'imports.refused.tooLarge',
  paused: 'imports.refused.paused',
  unavailable: 'imports.refused.unavailable',
  daily: 'imports.refused.daily',
  bytes: 'imports.refused.bytes',
  running: 'imports.refused.running',
  conflict: 'imports.refused.conflict',
  limited: 'imports.refused.limited',
  unauthorized: 'imports.refused.failed',
  failed: 'imports.refused.failed',
};

/** The message key for a refusal; a budget name without its month and year gets the example of a good one. */
export function refusalKey(reason: ImportReason, source: string): string {
  if (reason === 'name' && source === 'excel') return 'imports.errors.name';
  return KEYS[reason];
}

const TONES: Record<string, ChipTone> = {
  requested: 'running',
  importing: 'running',
  reconciling: 'running',
  done: 'ok',
  unchanged: 'idle',
  superseded: 'idle',
  stalled: 'warn',
  failed: 'failed',
  expired: 'failed',
};

export const statusTone = (status: string): ChipTone => TONES[status] ?? 'idle';

/** Still running: the screen polls it and says it is reading rows. */
export const RUNNING_STATUSES: readonly string[] = ['requested', 'importing', 'reconciling'];

/** The list with this import's latest record in it: in place when listed, else first (it is the newest). */
export function withImport(page: ImportsPage, record: ImportRecord): ImportsPage {
  const item: ImportItem = {
    import_id: record.import_id,
    source: record.source,
    file_name: record.file_name,
    period: record.period,
    status: record.status,
    created_at: record.created_at,
    active: record.active,
    ...(record.finished_at ? { finished_at: record.finished_at } : {}),
    ...(record.counts ? { counts: record.counts } : {}),
  };
  const listed = page.items.some((i) => i.import_id === record.import_id);
  return { ...page, items: listed ? page.items.map((i) => (i.import_id === record.import_id ? item : i)) : [item, ...page.items] };
}

type T = ReturnType<typeof useTranslations>;

/** The month a file covers ("October 2026"), the whole notes log, or the API's mark when it has none. */
export function periodText(t: T, period: string, locale: string, whole = false): string {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return monthName(period, locale);
  if (period === 'log') return whole ? t('imports.wholeLog') : t('imports.log');
  return period;
}

export const statusText = (t: T, status: string) => (t.has(`imports.status.${status}`) ? t(`imports.status.${status}`) : status);
