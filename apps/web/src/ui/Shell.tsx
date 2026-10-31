// The server shell (D-137): the rail on desktop (D-35 to D-42) and the top bar under 960px (D-24, D-43, D-44), with the
// account area at the rail's foot. Only ShellNav.tsx runs in the browser: it knows the current path. Money only, no Ask
// (D-46) and no Prototype group (D-36).
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Icon } from './primitives/Icon/Icon';
import styles from './Shell.module.css';
import { LangForm, ShellBar, ShellNav, type NavGroup, type ReviewCount } from './ShellNav';

export type ShellProps = {
  /** Who is signed in; a placeholder until PR 3 reads the session. */
  address: string;
  /** The stage tag beside the wordmark ("qa"); left out on production. */
  stage?: string;
  /** Rows waiting for review (D-44); 0 until PR 4 reads the review data. */
  reviewCount: number;
  children: ReactNode;
};

export async function Shell({ address, stage, reviewCount, children }: ShellProps) {
  const t = await getTranslations();
  const locale = await getLocale();
  const other = locale === 'es' ? 'en' : 'es';

  const groups: NavGroup[] = [
    {
      key: 'money',
      label: t('shell.groups.money'),
      items: [
        { href: '/overview', label: t('nav.dashboard'), icon: 'overview' },
        { href: '/transactions', label: t('nav.transactions'), icon: 'transactions' },
        { href: '/review', label: t('nav.review'), icon: 'review' },
        { href: '/imports', label: t('nav.imports'), icon: 'imports' },
        { href: '/rates', label: t('nav.rates'), icon: 'rates' },
      ],
    },
    { key: 'account', label: t('shell.groups.account'), items: [{ href: '/data', label: t('nav.data'), icon: 'data' }] },
  ];
  const review: ReviewCount | undefined = reviewCount > 0 ? { n: reviewCount, label: t('shell.toReview', { n: reviewCount }) } : undefined;

  // Who is signed in, then the other language and Sign out as plain rows (D-37, D-38). Rendered here and handed to the
  // menu panel as it is.
  const account = (
    <div className={styles.account} data-account="">
      <p className={styles.who}>
        <span>
          <span className={styles.srOnly}>{t('shell.signedIn')} </span>
          {address}
        </span>
        <small>{t('shell.mfaOn')}</small>
      </p>
      <LangForm lang={other} failed={t('shell.langFailed')}>
        <button type="submit" className={styles.row} lang={other}>
          <span className={styles.rowLabel}>
            <Icon name="language" size="lg" />
            <span>{t('shell.otherLanguage')}</span>
          </span>
        </button>
      </LangForm>
      {/* Sign out becomes a server action in PR 3 (SF-151); until then the row is in place without an action. */}
      <button type="button" className={styles.row}>
        <span className={styles.rowLabel}>
          <Icon name="signOut" size="lg" />
          <span>{t('shell.signOut')}</span>
        </span>
      </button>
    </div>
  );

  return (
    <div className={styles.app}>
      <aside className={styles.rail}>
        <ShellBar groups={groups} label={t('shell.screens')} menuLabel={t('shell.menu')} review={review} account={account}>
          <p className={styles.brand} data-brand="">
            <i className={styles.mark} aria-hidden="true" />
            cuenta
            {stage ? (
              <small className={styles.stage} data-stage-tag="">
                {stage}
              </small>
            ) : null}
          </p>
        </ShellBar>
        <div className={styles.body}>
          <ShellNav groups={groups} label={t('shell.screens')} review={review} />
          {account}
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
