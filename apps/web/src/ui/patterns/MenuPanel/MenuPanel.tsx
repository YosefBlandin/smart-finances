// MenuPanel: the top bar's menu under 960px (D-43, D-44). A 44px button names the current screen and carries the amber
// review count; it opens a panel over the page, under the bar, without moving the page, and shows a close mark while open.
// React Aria gives the popover, focus and Escape (D-141); the button is a plain one, and React Aria's popover loads on
// first use, so no page's first load carries it (D-190, T-WEB-17). The content gets a close function for when a link is chosen.
'use client';

import { useTranslations } from 'next-intl';
import { lazy, Suspense, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon } from '../../primitives/Icon/Icon';
import styles from './MenuPanel.module.css';

const load = () => import('./MenuPopover');
const MenuPopover = lazy(load);

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
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // The popover is mounted from the first press on, and stays mounted.
  const [used, setUsed] = useState(false);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={() => void load()}
        onFocus={() => void load()}
        onClick={() => {
          // Safari and Firefox do not focus a button on click; React Aria gives focus back to it on close.
          trigger.current?.focus();
          setUsed(true);
          setOpen(true);
        }}
      >
        <span>{label}</span>
        {count ? (
          <span className={styles.count} data-count="">
            <span aria-hidden="true">{count}</span>
            <span className={styles.srOnly}>{countLabel ?? count}</span>
          </span>
        ) : null}
        <Icon name={open ? 'close' : 'menu'} size="lg" />
      </button>
      {used ? (
        <Suspense fallback={null}>
          <MenuPopover isOpen={open} onOpenChange={setOpen} triggerRef={anchorRef ?? trigger} label={t('shell.menu')}>
            {children}
          </MenuPopover>
        </Suspense>
      ) : null}
    </>
  );
}
