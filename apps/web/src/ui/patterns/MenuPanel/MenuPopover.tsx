// MenuPanel's popover, loaded on first use (D-190): React Aria gives the popover under the bar, focus and Escape (D-141).
'use client';

import type { ReactNode, RefObject } from 'react';
import { Dialog, Popover } from 'react-aria-components';
import styles from './MenuPanel.module.css';

export type MenuPopoverProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<Element | null>;
  label: string;
  children: (close: () => void) => ReactNode;
};

export default function MenuPopover({ isOpen, onOpenChange, triggerRef, label, children }: MenuPopoverProps) {
  return (
    <Popover
      className={styles.popover}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      triggerRef={triggerRef}
      placement="bottom"
      offset={0}
      containerPadding={0}
    >
      <Dialog className={styles.panel} aria-label={label}>
        {children(() => onOpenChange(false))}
      </Dialog>
    </Popover>
  );
}
