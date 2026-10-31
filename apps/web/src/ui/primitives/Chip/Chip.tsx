// Chip: a status as an uppercase label with its icon beside the word (D-17). Failed statuses are red (D-63);
// attention is amber, running blue, done green, idle muted.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './Chip.module.css';

export type ChipTone = 'ok' | 'running' | 'warn' | 'failed' | 'idle';

const ICON: Record<ChipTone, IconName> = { ok: 'done', running: 'running', warn: 'alert', failed: 'failed', idle: 'clock' };

export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span className={styles.chip} data-tone={tone}>
      <Icon name={ICON[tone]} />
      {children}
    </span>
  );
}
