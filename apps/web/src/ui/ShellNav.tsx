// The shell's client islands (owner decision on SF-111, 2026-10-30). A shared layout never learns the current path, so
// the parts that depend on it live here: the rail's links with aria-current and the 2px ink mark (D-39), the top bar's
// MenuPanel under 960px with the same links and the account rows (D-43, D-44), and the language form that tells
// /api/lang which address to come back to (AC-4). Props are plain data or server-rendered nodes; everything else stays on the server.
'use client';

import { IconArrowsExchange, IconCoin, IconDatabase, IconLayoutDashboard, IconListCheck, IconUpload } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useRef, useTransition, type FormEvent, type ReactNode } from 'react';
import { MenuPanel } from './patterns/MenuPanel/MenuPanel';
import styles from './Shell.module.css';

// Tabler outline icons at a 2px stroke, as in the prototype's rail (D-17, D-58).
const NAV_ICONS = {
  overview: IconLayoutDashboard,
  transactions: IconArrowsExchange,
  review: IconListCheck,
  imports: IconUpload,
  rates: IconCoin,
  data: IconDatabase,
} as const;

export type NavIcon = keyof typeof NAV_ICONS;
export type NavItem = { href: string; label: string; icon: NavIcon };
export type NavGroup = { key: string; label: string; items: NavItem[] };
export type ReviewCount = { n: number; label: string };

const isCurrent = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

function NavLinks({ groups, label, review, onChoose }: { groups: NavGroup[]; label: string; review?: ReviewCount; onChoose?: () => void }) {
  const path = usePathname();
  return (
    <nav className={styles.nav} aria-label={label}>
      {groups.map((group) => [
        <div key={`label-${group.key}`} className={styles.groupLabel} data-group={group.key}>
          {group.label}
        </div>,
        ...group.items.map((item) => {
          const Svg = NAV_ICONS[item.icon];
          const count = item.icon === 'review' && review && review.n > 0 ? review : undefined;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={styles.row}
              aria-current={isCurrent(path, item.href) ? 'page' : undefined}
              onClick={onChoose}
            >
              <span className={styles.rowLabel}>
                <Svg size={18} stroke={2} className={styles.icon} aria-hidden="true" focusable="false" />
                <span>{item.label}</span>
              </span>
              {count ? (
                <span className={styles.count}>
                  <span aria-hidden="true">{count.n}</span>
                  <span className={styles.srOnly}>{count.label}</span>
                </span>
              ) : null}
            </Link>
          );
        }),
      ])}
    </nav>
  );
}

/** The rail's links (desktop); hidden with the rest of the rail body under 960px. */
export function ShellNav(props: { groups: NavGroup[]; label: string; review?: ReviewCount }) {
  return <NavLinks {...props} />;
}

/**
 * The top of the rail: the brand (server-rendered children) and, under 960px, the menu button. The panel opens under
 * this bar and holds the same links and the account rows; choosing a link closes it.
 */
export function ShellBar(props: {
  groups: NavGroup[];
  label: string;
  menuLabel: string;
  review?: ReviewCount;
  account: ReactNode;
  children: ReactNode;
}) {
  const { groups, label, menuLabel, review, account, children } = props;
  const bar = useRef<HTMLDivElement>(null);
  const path = usePathname();
  const current = groups.flatMap((g) => g.items).find((item) => isCurrent(path, item.href));
  return (
    <div ref={bar} className={styles.bar} data-topbar="">
      {children}
      <div className={styles.menuSlot}>
        <MenuPanel label={current?.label ?? menuLabel} count={review?.n} countLabel={review?.label} anchorRef={bar}>
          {(close) => (
            <div className={styles.panelBody}>
              <NavLinks groups={groups} label={label} review={review} onChoose={close} />
              {account}
            </div>
          )}
        </MenuPanel>
      </div>
    </div>
  );
}

function PathAndSearch() {
  const path = usePathname();
  const search = useSearchParams().toString();
  return <input type="hidden" name="next" value={search ? `${path}?${search}` : path} />;
}

function PathOnly() {
  return <input type="hidden" name="next" value={usePathname()} />;
}

/**
 * The language row's form: posts to /api/lang with the address to come back to, so the person stays on the same
 * screen (AC-4). The page's Referrer-Policy (no-referrer) makes a plain form post send "Origin: null", which /api/lang
 * refuses (Contracts "Cookies"), so the post goes through fetch with a same-origin referrer policy, and the server
 * components are then rendered again in the new language. The button is server-rendered and comes in as children.
 */
export function LangForm({ lang, children }: { lang: string; children: ReactNode }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const res = await fetch(form.action, { method: 'POST', body: new FormData(form), referrerPolicy: 'same-origin', redirect: 'manual' });
    if (res.type === 'opaqueredirect' || res.ok) startTransition(() => router.refresh());
  }
  return (
    <form method="post" action="/api/lang" onSubmit={onSubmit}>
      <input type="hidden" name="lang" value={lang} />
      <Suspense fallback={<PathOnly />}>
        <PathAndSearch />
      </Suspense>
      {children}
    </form>
  );
}
