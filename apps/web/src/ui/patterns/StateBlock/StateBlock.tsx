// StateBlock: what a screen or section shows while it is loading, empty, failed or only partly there (AC-8).
// Loading is skeleton lines with one polite "Loading" (D-128); the others say what happened in plain words and offer
// the next step. No red here: a failed section's own red note is a Note (D-63).
'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '../../primitives/Button/Button';
import { Icon, type IconName } from '../../primitives/Icon/Icon';
import { Skeleton } from '../../primitives/Skeleton/Skeleton';
import styles from './StateBlock.module.css';

export type StateKind = 'loading' | 'empty' | 'error' | 'partial';

export type StateBlockProps = {
  kind: StateKind;
  title?: string;
  text?: string;
  /** The next step: a link or a Button. */
  action?: ReactNode;
  /** For the failed state: shows a "Try again" button. */
  onRetry?: () => void;
  headingLevel?: 2 | 3;
  /** Skeleton lines while loading. */
  lines?: number;
};

const ICON: Record<Exclude<StateKind, 'loading'>, IconName> = { empty: 'inbox', error: 'alert', partial: 'info' };
const WIDTHS = ['wide', 'full', 'half', 'full', 'short'] as const;

export function StateBlock({ kind, title, text, action, onRetry, headingLevel = 2, lines = 3 }: StateBlockProps) {
  const t = useTranslations();
  if (kind === 'loading') {
    return (
      <div className={styles.loading} data-kind="loading" role="status">
        <span className={styles.srOnly}>{t('states.loading')}</span>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} width={WIDTHS[i % WIDTHS.length]} />
        ))}
      </div>
    );
  }
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div className={styles.state} data-kind={kind}>
      <span className={styles.icon}>
        <Icon name={ICON[kind]} size="lg" />
      </span>
      {title ? <Heading className={styles.title}>{title}</Heading> : null}
      {text ? <p className={styles.text}>{text}</p> : null}
      {action || onRetry ? (
        <div className={styles.actions}>
          {onRetry ? (
            <Button icon="retry" onClick={onRetry}>
              {t('states.retry')}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
