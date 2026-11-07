import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LegalPage } from '../privacy/_legal/LegalPage';
import { publicStage } from '../privacy/_legal/stage';
import { TERMS_VERSION } from '../privacy/_legal/versions';

// The terms (AC-14, D-145): what Cuenta is and is not (no advice, no money movement), read only, for anyone.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.terms');
  return { title: `${t('title')} · Cuenta` };
}

export default async function TermsPage() {
  const t = await getTranslations('legal.terms');
  const common = await getTranslations('legal.common');
  const { supportAddress, testStage } = publicStage();
  return (
    <LegalPage
      title={t('title')}
      lead={t('lead')}
      version={TERMS_VERSION}
      testStage={testStage}
      contact={supportAddress}
      other={{ href: '/privacy', label: common('toPrivacy') }}
      sections={[
        { title: t('whatTitle'), items: [t('what'), t('check')] },
        { title: t('notTitle'), list: true, items: [t('notAdvice'), t('notMoney')] },
        {
          title: t('accountTitle'),
          list: true,
          items: [t('accountOne'), t('accountOwn'), t.rich('accountLost', { lost: (chunks) => <Link href="/lost-authenticator">{chunks}</Link> })],
        },
        { title: t('limitsTitle'), items: [t('limits')] },
        { title: t('leaveTitle'), items: [t('leave')] },
        { title: t('changesTitle'), items: [t('changes')] },
      ]}
    />
  );
}
