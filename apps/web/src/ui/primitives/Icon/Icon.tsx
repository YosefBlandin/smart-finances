// Tabler outline icons at a 2px stroke, bundled with the app (D-17, D-58). Always beside a word: decorative by default,
// an image with a name only when a label is given. Only the icons listed here are imported, so the bundle stays small.
import {
  IconAlertTriangle,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconDownload,
  IconFileImport,
  IconInbox,
  IconInfoCircle,
  IconLanguage,
  IconLoader2,
  IconLogout,
  IconMenu2,
  IconProgress,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import styles from './Icon.module.css';

const ICONS = {
  alert: IconAlertTriangle,
  calendar: IconCalendar,
  check: IconCheck,
  chevronDown: IconChevronDown,
  done: IconCircleCheck,
  failed: IconCircleX,
  clock: IconClock,
  download: IconDownload,
  import: IconFileImport,
  inbox: IconInbox,
  info: IconInfoCircle,
  language: IconLanguage,
  loader: IconLoader2,
  signOut: IconLogout,
  menu: IconMenu2,
  running: IconProgress,
  retry: IconRefresh,
  trash: IconTrash,
  close: IconX,
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const PX = { sm: 14, md: 16, lg: 18 } as const;

export type IconProps = {
  name: IconName;
  /** sm 14px (flags), md 16px (chips, buttons), lg 18px (rail and notes). */
  size?: keyof typeof PX;
  /** Only when the icon stands for a word that is not written beside it. */
  label?: string;
};

export function Icon({ name, size = 'md', label }: IconProps) {
  const Svg = ICONS[name];
  return (
    <Svg
      size={PX[size]}
      stroke={2}
      className={styles.icon}
      data-icon={name}
      focusable="false"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    />
  );
}
