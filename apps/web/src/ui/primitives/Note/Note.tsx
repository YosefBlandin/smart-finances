// Note: a short message with its icon. Error notes are red (D-63); warn is amber; info is plain.
// The role is the caller's choice: role="alert" for a form's message, role="status" for something that changed.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './Note.module.css';

export type NoteTone = 'info' | 'warn' | 'error';

const ICON: Record<NoteTone, IconName> = { info: 'info', warn: 'alert', error: 'failed' };

export type NoteProps = {
  tone?: NoteTone;
  title?: string;
  role?: 'alert' | 'status';
  children: ReactNode;
};

export function Note({ tone = 'info', title, role, children }: NoteProps) {
  return (
    <div className={styles.note} data-tone={tone} role={role}>
      <span className={styles.icon}>
        <Icon name={ICON[tone]} size="lg" />
      </span>
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
