'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useSyncExternalStore, type DragEvent } from 'react';
import { useImports } from '@/queries/data';
import { DataTable } from '@/ui/patterns/DataTable/DataTable';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import { Chip } from '@/ui/primitives/Chip/Chip';
import { SelectField } from '@/ui/primitives/Field/Field';
import { Note } from '@/ui/primitives/Note/Note';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton';
import { SOURCES } from '@smart-finances/contracts/routes';
import { ImportDetail } from './Detail';
import styles from './Imports.module.css';
import { fileRefusal, periodText, refusalKey, SOURCE_IDS, statusText, statusTone, type ImportItem, type SourceId } from './model';

// The imports island (SF-167; AC-5, D-114): pick where the file comes from (its name and size rule shows under the
// choice), then choose or drop the file. The browser checks it with the contracts' rule first, so a file that cannot fit
// is refused with the reason and nothing is sent; then the requestImport action asks for an upload form (the caps and
// the pause switch are checked there), the file is posted to that form with fetch and FormData, and the import opens
// beside the list until it ends. Imports wait for the server's answer: nothing here is optimistic (D-131).

export type ImportStart = { importId: string; upload: { url: string; fields: Record<string, string> } };
export type RequestResult = { ok: true; data: ImportStart } | { ok: false; messageKey: string };
export type ImportsProps = {
  request: (input: { source: string; fileName: string; size: number }) => Promise<RequestResult>;
};

// React Aria's select renders a hidden native select with a style attribute, which the content policy refuses in
// server HTML; the select renders after hydration with a skeleton until then (SF-165's workaround; SF-171 fixes Field).
const noSubscribe = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

/** "Mercado Pago", "Monthly budget": the source's name as an option, first letter up. */
const capitalised = (name: string, locale: string) => name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);

export function Imports({ request }: ImportsProps) {
  const t = useTranslations();
  const locale = useLocale();
  const hydrated = useHydrated();
  const list = useImports();
  const [source, setSource] = useState<SourceId>('mercadopago');
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<string>();
  const [open, setOpen] = useState<string>();
  const [dragging, setDragging] = useState(false);

  async function send(file: File) {
    setRefused(undefined);
    const reason = fileRefusal(source, file);
    if (reason) {
      setRefused(refusalKey(reason, source));
      return;
    }
    setSending(true);
    try {
      const started = await request({ source, fileName: file.name, size: file.size });
      if (!started.ok) {
        setRefused(started.messageKey);
        return;
      }
      // The presigned form: its fields first, the file last (S3 POST policy).
      const form = new FormData();
      for (const [name, value] of Object.entries(started.data.upload.fields)) form.append(name, value);
      form.append('file', file);
      const sent = await fetch(started.data.upload.url, { method: 'POST', body: form }).catch(() => undefined);
      // Either way the import opens and is read until it ends, so the server settles the person's slot (D-114); one
      // whose file never arrived ends as expired and gives its bytes back.
      setOpen(started.data.importId);
      if (!sent?.ok) setRefused('imports.refused.upload');
    } catch {
      setRefused('imports.refused.failed');
    } finally {
      setSending(false);
    }
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file && !sending) void send(file);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files);
  }

  const names = (s: string) => (t.has(`sources.names.${s}`) ? t(`sources.names.${s}`) : s);
  const options = SOURCE_IDS.map((id) => ({ id, label: capitalised(names(id), locale) }));
  const items = list.data?.items ?? [];
  const opened = open ? items.find((i) => i.import_id === open) : undefined;

  return (
    <div className={styles.screen}>
      <div className={styles.picker}>
        <div className={styles.source}>
          {hydrated ? (
            <SelectField label={t('imports.whereFrom')} value={source} options={options} onChange={(id) => setSource(id)} />
          ) : (
            <Skeleton width="short" height="block" />
          )}
          <p className={styles.rule}>{t(`imports.rules.${source}`)}</p>
        </div>
        <div
          className={styles.drop}
          data-dragging={dragging || undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <label className={styles.choose} data-busy={sending || undefined}>
            <input
              className={styles.file}
              type="file"
              accept={SOURCES[source].extension}
              disabled={sending}
              onChange={(event) => {
                pick(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />
            {t('imports.choose')}
          </label>
          <span className={styles.or}>{sending ? t('imports.sending') : t('imports.orDrop')}</span>
        </div>
        {refused ? (
          <Note tone="error" role="alert">
            {t(refused)}
          </Note>
        ) : null}
      </div>

      <div className={styles.columns}>
        <ImportList
          items={items}
          loading={!list.data && !list.error}
          failed={!list.data && Boolean(list.error) && !list.isFetching}
          onRetry={() => void list.refetch()}
          open={open}
          onOpen={setOpen}
        />
        {open ? <ImportDetail key={open} id={open} listed={opened} /> : null}
      </div>
    </div>
  );
}

type ImportListProps = {
  items: ImportItem[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  open: string | undefined;
  onOpen: (id: string) => void;
};

function ImportList({ items, loading, failed, onRetry, open, onOpen }: ImportListProps) {
  const t = useTranslations();
  const locale = useLocale();
  if (failed) return <StateBlock kind="error" title={t('states.errT')} text={t('states.errB')} onRetry={onRetry} />;
  if (loading) return <StateBlock kind="loading" lines={6} />;
  if (items.length === 0) return <StateBlock kind="empty" title={t('states.empty.imports.title')} text={t('states.empty.imports.text')} />;
  return (
    <DataTable.Root label={t('nav.imports')}>
      <DataTable.Header>
        <DataTable.Column>{t('imports.file')}</DataTable.Column>
        <DataTable.Column>{t('imports.covers')}</DataTable.Column>
        <DataTable.Column>{t('imports.statusCol')}</DataTable.Column>
        <DataTable.Column align="end">{t('imports.rows')}</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {items.map((item) => (
          <DataTable.Row key={item.import_id} selected={item.import_id === open}>
            <DataTable.Cell>
              <button type="button" className={styles.open} aria-expanded={item.import_id === open} onClick={() => onOpen(item.import_id)}>
                {item.file_name}
              </button>
            </DataTable.Cell>
            <DataTable.Cell>
              <span className={styles.nowrap}>{periodText(t, item.period, locale)}</span>
            </DataTable.Cell>
            <DataTable.Cell>
              <span className={styles.status}>
                <Chip tone={statusTone(item.status)}>{statusText(t, item.status)}</Chip>
                {item.active ? <span className={styles.inUse}>{t('imports.inUse')}</span> : null}
              </span>
            </DataTable.Cell>
            <DataTable.Cell align="end">
              <span className={styles.nowrap}>{item.counts ? item.counts.added + item.counts.updated : '—'}</span>
            </DataTable.Cell>
          </DataTable.Row>
        ))}
      </DataTable.Body>
    </DataTable.Root>
  );
}
