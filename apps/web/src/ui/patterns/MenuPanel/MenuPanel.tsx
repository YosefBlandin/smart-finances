// MenuPanel: the top bar's menu under 960px (D-43, D-44). A 44px button names the current screen and carries the amber
// review count; it opens a panel over the page, under the bar, without moving the page, and shows a close mark while open.
// React Aria gives the popover, focus and Escape (D-141). The content gets a close function for when a link is chosen.
'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode, type RefObject } from 'react';
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { Icon } from '../../primitives/Icon/Icon';
import styles from './MenuPanel.module.css';

export type MenuPanelProps = {
  /** The current screen's name. */
  label: string;
  /** Rows waiting for review; no count is shown when it is 0 or left out. */
  count?: number;
  /** The count in words for screen readers, e.g. "3 to review". */
  countLabel?: string;
  /** The bar the panel opens under; the button itself when left out. */
  anchorRef?: RefObject<Element | null>;
  children: (close: () => void) => ReactNode;
};

export function MenuPanel({ label, count, countLabel, anchorRef, children }: MenuPanelProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button className={styles.trigger}>
        <span>{label}</span>
        {count ? (
          <span className={styles.count} data-count="">
            <span aria-hidden="true">{count}</span>
            <span className={styles.srOnly}>{countLabel ?? count}</span>
          </span>
        ) : null}
        <Icon name={open ? 'close' : 'menu'} size="lg" />
      </Button>
      <Popover className={styles.popover} triggerRef={anchorRef} placement="bottom" offset={0} containerPadding={0}>
        <Dialog className={styles.panel} aria-label={t('shell.menu')}>
          {({ close }) => children(close)}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
