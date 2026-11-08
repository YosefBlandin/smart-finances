// ConfirmDialog: asks before an action that cannot be undone from here. React Aria gives the modal, focus and Escape
// (D-141); it loads the first time the dialog opens, so no page's first load carries it (D-190, T-WEB-17). A destructive
// one uses the red danger Button (D-146) and can wait for a typed word such as DELETE (AC-7); while the action runs the
// button spins and Cancel waits (D-128). The screen owns the button that opens it.
'use client';

import { lazy, Suspense, useState, type ReactNode } from 'react';

const ConfirmModal = lazy(() => import('./ConfirmModal'));

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

export function ConfirmDialog(props: ConfirmDialogProps) {
  // Mounted from the first open on, and kept mounted, so React Aria's closing runs as before.
  const [used, setUsed] = useState(props.isOpen);
  if (props.isOpen && !used) setUsed(true);
  return used ? (
    <Suspense fallback={null}>
      <ConfirmModal {...props} />
    </Suspense>
  ) : null;
}
