import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Icon } from '@/ui/primitives/Icon/Icon';
import type { Waiting } from '../model';
import { Section } from '../Section';
import { monthName } from '../text';
import styles from './Waiting.module.css';

// What is waiting for you (D-18): one plain list under the colour field, shown only when something is. Each line has
// an amber icon, the sentence and a small link to the screen that fixes it; no tinted panel (D-21).

export function WaitingView({ month, waiting }: { month: string; waiting: Waiting }) {
  const t = useTranslations();
  const locale = useLocale();
  const items: { key: string; text: string; href: string; go: string }[] = [];
  if (waiting.missingRate)
    items.push({ key: 'rate', text: t('overview.missingTitle', { m: monthName(month, locale) }), href: '/rates', go: t('overview.addRate') });
  if (waiting.review > 0)
    items.push({ key: 'review', text: t('overview.todoReview', { n: waiting.review }), href: '/review', go: t('overview.todoReviewGo') });
  if (waiting.imports > 0)
    items.push({ key: 'imports', text: t('overview.todoImports', { n: waiting.imports }), href: '/imports', go: t('overview.todoImportsGo') });
  if (items.length === 0) return null;
  return (
    <Section name="waiting">
      <ul className={styles.list} aria-label={t('shell.waiting')}>
        {items.map((item) => (
          <li key={item.key} className={styles.item}>
            <span className={styles.icon}>
              <Icon name="alert" />
            </span>
            <span className={styles.text}>{item.text}</span>
            <Link href={item.href} className={styles.go}>
              {item.go}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
