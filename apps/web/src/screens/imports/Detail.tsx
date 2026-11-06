'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { importPollDelay, useImport } from '@/queries/data';
import { dataKeys, FINAL_IMPORT_STATUSES, type ImportRecord, type ImportsPage } from '@/queries/keys';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import { Chip } from '@/ui/primitives/Chip/Chip';
import { Note } from '@/ui/primitives/Note/Note';
import { lang } from '../overview/text';
import styles from './Imports.module.css';
import { periodText, RUNNING_STATUSES, statusText, statusTone, withImport, type ImportItem } from './model';

// One import beside the list (SF-167; AC-5): polled until it is final or stalled (useImport: 3 s doubling to 30 s, at
// most 23 reads), with its status, what it covers, when it ran, its counts and each skipped row: a translated lead, then
// the importer's own words exactly as it wrote them, in English (D-86), as text only (AC-9). Each answer is written
// into the imports list, so the list follows without asking again; at a final status the totals, the review rows and
// the transactions are marked stale, to be asked again where they are shown next (the person's reads a minute, AC-17).

const INTL = { en: 'en-US', es: 'es-AR' } as const;
/** Reads made of an import, answered or failed: what the polling counts against its cap. */
const reads = (state: { dataUpdateCount: number; errorUpdateCount: number } | undefined) =>
  (state?.dataUpdateCount ?? 0) + (state?.errorUpdateCount ?? 0);

export function ImportDetail({ id, listed }: { id: string; listed: ImportItem | undefined }) {
  const t = useTranslations();
  const locale = useLocale();
  const client = useQueryClient();
  const query = useImport(id);
  const record: ImportRecord | ImportItem | undefined = query.data ?? listed;

  const status = query.data?.status;
  useEffect(() => {
    if (!query.data) return;
    const page = client.getQueryData<ImportsPage>(dataKeys.imports());
    if (page) client.setQueryData<ImportsPage>(dataKeys.imports(), withImport(page, query.data));
    if (status !== undefined && FINAL_IMPORT_STATUSES.includes(status)) {
      for (const key of ['totals', 'review', 'transactions'])
        void client.invalidateQueries({ queryKey: [...dataKeys.all, key], refetchType: 'none' });
    }
  }, [client, query.data, status]);

  if (!record) {
    if (query.error && !query.isFetching) {
      return (
        <aside className={styles.detail} aria-label={id}>
          <StateBlock kind="error" title={t('states.errT')} text={t('states.errB')} onRetry={() => void query.refetch()} />
        </aside>
      );
    }
    return (
      <aside className={styles.detail} aria-busy="true" aria-label={id}>
        <StateBlock kind="loading" lines={4} />
      </aside>
    );
  }

  const time = new Intl.DateTimeFormat(INTL[lang(locale)], { dateStyle: 'medium', timeStyle: 'short' });
  const skipped = query.data?.skipped ?? [];
  const skippedCount = record.counts?.skipped ?? skipped.length;
  const running = RUNNING_STATUSES.includes(record.status);
  // The polling stopped at its cap while the import still runs: say it goes on without the screen watching.
  const capped = running && !query.isFetching && importPollDelay(reads(client.getQueryState(dataKeys.import(id)))) === false;
  const error = query.data?.error;

  return (
    <aside className={styles.detail} aria-label={record.file_name}>
      <div className={styles.detailHead}>
        <h2 className={styles.detailTitle}>{record.file_name}</h2>
        <Chip tone={statusTone(record.status)}>{statusText(t, record.status)}</Chip>
      </div>

      <dl className={styles.facts}>
        <dt>{t('imports.covers')}</dt>
        <dd>{periodText(t, record.period, locale, true)}</dd>
        <dt>{t('imports.started')}</dt>
        <dd>{time.format(new Date(record.created_at))}</dd>
        {record.finished_at ? (
          <>
            <dt>{t('imports.finished')}</dt>
            <dd>{time.format(new Date(record.finished_at))}</dd>
          </>
        ) : null}
        <dt>{t('imports.inUseQ')}</dt>
        <dd>{record.active ? t('imports.inUseYes') : t('imports.no')}</dd>
        <dt>{t('imports.importId')}</dt>
        <dd className={styles.mono}>{record.import_id}</dd>
      </dl>

      {record.counts ? (
        <dl className={styles.counts}>
          {(['added', 'updated', 'removed', 'skipped'] as const).map((k) => (
            <div key={k}>
              <dt>{t(`imports.${k}`)}</dt>
              <dd>{record.counts![k]}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {running ? <Note role="status">{capped ? t('imports.continues') : t('imports.reading')}</Note> : null}

      {record.status === 'stalled' ? (
        <Note tone="warn" title={t('imports.stalledTitle')}>
          {t('imports.stalledBody')}
        </Note>
      ) : null}

      {error && t.has(`imports.errors.${error}`) ? <Note tone="error">{t(`imports.errors.${error}`)}</Note> : null}

      {skippedCount > 0 ? (
        <Note tone="warn" title={t('imports.skippedTitle', { n: skippedCount })}>
          {skipped.length > 0 ? (
            // The importer's own words, in English as it wrote them (D-86).
            <ul className={styles.skipped} lang="en">
              {skipped.map((row, i) => (
                <li key={`${row.where}-${i}`}>
                  <span className={styles.where}>{row.where}</span>
                  <span className={styles.mono}>{row.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Note>
      ) : null}
    </aside>
  );
}
