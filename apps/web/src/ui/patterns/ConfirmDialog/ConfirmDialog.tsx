// ConfirmDialog: asks before an action that cannot be undone from here. React Aria gives the modal, focus and Escape
// (D-141). A destructive one uses the red danger Button (D-146) and can wait for a typed word such as DELETE (AC-7);
// while the action runs the button spins and Cancel waits (D-128). The screen owns the button that opens it.
'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '../../primitives/Button/Button';
import { Field } from '../../primitives/Field/Field';
import styles from './ConfirmDialog.module.css';

export type ConfirmDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  /** When set, the confirm button waits until this word is typed exactly. */
  confirmWord?: string;
  busy?: boolean;
  children: ReactNode;
};

export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  confirmLabel,
  onConfirm,
  destructive,
  confirmWord,
  busy,
  children,
}: ConfirmDialogProps) {
  const t = useTranslations();
  const [typed, setTyped] = useState('');
  const change = (open: boolean) => {
    if (!open) setTyped('');
    onOpenChange(open);
  };
  return (
    <ModalOverlay className={styles.overlay} isOpen={isOpen} onOpenChange={change} isDismissable={!busy} isKeyboardDismissDisabled={busy}>
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog} role="alertdialog">
          <Heading slot="title" className={styles.title}>
            {title}
          </Heading>
          <div className={styles.body}>{children}</div>
          {confirmWord ? <Field label={t('ui.typeToConfirm', { word: confirmWord })} value={typed} onChange={setTyped} autoComplete="off" /> : null}
          <div className={styles.actions}>
            <Button onClick={() => change(false)} disabled={busy}>
              {t('auth.common.cancel')}
            </Button>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              busy={busy}
              disabled={confirmWord !== undefined && typed !== confirmWord}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
