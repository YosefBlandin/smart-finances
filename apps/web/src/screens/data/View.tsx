'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/ui/patterns/ConfirmDialog/ConfirmDialog';
import { Button } from '@/ui/primitives/Button/Button';
import { Icon } from '@/ui/primitives/Icon/Icon';
import { Note } from '@/ui/primitives/Note/Note';
import type { ErasePhase } from './model';
import styles from './Data.module.css';

// Your data (SF-168; AC-7, AC-8, D-146): what is stored, the export, erase everything and the way to delete the account,
// as sections told apart by space and fine rules (D-21). Erasing asks for the typed word DELETE in a dialog that says
// backups keep it for 35 days; the erase buttons are the red danger variant (D-146). The counts come from the server's
// answer; a timeout or a server failure shows the unfinished note with Finish erasing, the same action again.

const STORED = [
  ['sTx', 'sTxD'],
  ['sFiles', 'sFilesD'],
  ['sChoices', 'sChoicesD'],
  ['sRates', 'sRatesD'],
  ['sTotals', 'sTotalsD'],
] as const;

export type DataViewProps = {
  phase: ErasePhase;
  /** The erase action is running: its button spins (D-128). */
  busy: boolean;
  /** The DELETE dialog is open. */
  asking: boolean;
  onAsk: (open: boolean) => void;
  onErase: () => void;
};

export function DataView({ phase, busy, asking, onAsk, onErase }: DataViewProps) {
  const t = useTranslations();
  return (
    <div className={styles.screen}>
      <section className={styles.section} aria-labelledby="data-stored">
        <h2 id="data-stored">{t('data.stored')}</h2>
        <dl className={styles.stored}>
          {STORED.map(([what, why]) => (
            <div key={what} className={styles.storedRow}>
              <dt>{t(`data.${what}`)}</dt>
              <dd>{t(`data.${why}`)}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.muted}>{t('data.storedFoot')}</p>
      </section>

      <section className={styles.section} aria-labelledby="data-export">
        <h2 id="data-export">{t('data.export')}</h2>
        <p className={styles.lead}>{t('data.exportBody')}</p>
        <div>
          {/* A plain download (GET /api/data/export): the route answers the CSV as an attachment. */}
          <a href="/api/data/export" className={styles.go}>
            <Icon name="download" />
            <span>{t('data.download')}</span>
          </a>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="data-erase">
        <h2 id="data-erase">{t('data.delTitle')}</h2>
        {phase.kind === 'done' ? (
          <Note tone="info" role="status" title={t('data.deleted')}>
            <dl className={styles.counts}>
              <div>
                <dt>{t('data.countRecords')}</dt>
                <dd>{phase.erased.items}</dd>
              </div>
              <div>
                <dt>{t('data.countFiles')}</dt>
                <dd>{phase.erased.files}</dd>
              </div>
            </dl>
            <p className={styles.noteText}>{t('data.erasedNote')}</p>
          </Note>
        ) : phase.kind === 'unfinished' ? (
          <Note tone="error" role="alert" title={t('data.eraseUnfinishedTitle')}>
            <p className={styles.noteText}>{t('data.eraseUnfinished')}</p>
            <div className={styles.noteAction}>
              <Button variant="danger" busy={busy} onClick={onErase}>
                {t('data.finishErase')}
              </Button>
            </div>
          </Note>
        ) : (
          <>
            <p className={styles.lead}>{t('data.delBody')}</p>
            <p className={styles.muted}>{t('data.delBackup')}</p>
            {phase.kind === 'refused' ? (
              <Note tone="error" role="alert">
                {t(phase.messageKey)}
              </Note>
            ) : null}
            <div>
              <Button variant="danger" icon="trash" onClick={() => onAsk(true)}>
                {t('data.delBtn')}
              </Button>
            </div>
          </>
        )}
      </section>

      <section className={styles.section} aria-labelledby="data-account">
        <h2 id="data-account">{t('auth.delete.warnTitle')}</h2>
        <p className={styles.lead}>{t('auth.delete.warnLead')}</p>
        <div>
          <Link href="/data/delete" className={styles.go}>
            {t('auth.delete.submit')}
          </Link>
        </div>
      </section>

      <ConfirmDialog
        // A fresh dialog each time it opens, so the typed word never carries over.
        key={asking ? 'open' : 'closed'}
        isOpen={asking}
        onOpenChange={onAsk}
        title={t('data.delTitle')}
        confirmLabel={t('data.delBtn')}
        destructive
        confirmWord="DELETE"
        busy={busy}
        onConfirm={onErase}
      >
        <p>{t('data.delBody')}</p>
        <p className={styles.muted}>{t('data.delBackup')}</p>
      </ConfirmDialog>
    </div>
  );
}
