// ConfirmDialog's modal, loaded the first time the dialog opens (D-190): React Aria gives the modal, focus and Escape
// (D-141).
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '../../primitives/Button/Button';
import { Field } from '../../primitives/Field/Field';
import type { ConfirmDialogProps } from './ConfirmDialog';
import styles from './ConfirmDialog.module.css';

export default function ConfirmModal({
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
