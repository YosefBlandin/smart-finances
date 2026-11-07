import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Note } from '@/ui/primitives/Note/Note';
import styles from './legal.module.css';

export type LegalSection = { title: string; items: ReactNode[]; list?: boolean };

type Props = {
  title: string;
  lead: string;
  version: string;
  /** qa and test are test stages whose data may be wiped (D-118). */
  testStage: boolean;
  contact: string;
  sections: LegalSection[];
  other: { href: '/privacy' | '/terms'; label: string };
};

// The privacy notice and the terms: read-only full text under one version id, with no accept control (D-145).
// Acceptance happens once on the sign-up page, and again on the consent screen when a version changes.
export async function LegalPage({ title, lead, version, testStage, contact, sections, other }: Props) {
  const t = await getTranslations('legal.common');
  return (
    <main className={styles.page}>
      <article className={styles.card}>
        <header className={styles.header}>
          <p className={styles.brand}>cuenta</p>
          <h1 className={styles.title} tabIndex={-1}>
            {title}
          </h1>
          <p className={styles.version} data-version={version}>
            {t('version', { version })}
          </p>
          <p className={styles.lead}>{lead}</p>
        </header>
        {testStage ? (
          <Note tone="warn" title={t('testStageTitle')}>
            {t('testStage')}
          </Note>
        ) : null}
        {sections.map((s) => (
          <section key={s.title} className={styles.section}>
            <h2 className={styles.heading}>{s.title}</h2>
            {s.list ? (
              <ul className={styles.list}>
                {s.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              s.items.map((item, i) => <p key={i}>{item}</p>)
            )}
          </section>
        ))}
        <section className={styles.section}>
          <h2 className={styles.heading}>{t('contactTitle')}</h2>
          <p>{t('contact', { contact })}</p>
        </section>
        <p className={styles.note}>{t('readOnly')}</p>
        <nav className={styles.links}>
          <Link href={other.href}>{other.label}</Link>
          <Link href="/overview">{t('home')}</Link>
        </nav>
      </article>
    </main>
  );
}
