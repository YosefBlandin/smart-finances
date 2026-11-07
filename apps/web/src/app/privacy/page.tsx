import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalPage } from './_legal/LegalPage';
import { publicStage } from './_legal/stage';
import { PRIVACY_VERSION } from './_legal/versions';

// The privacy notice (AC-14, D-145): what is stored, where, how long and how to remove it, read only, for anyone.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.privacy');
  return { title: `${t('title')} · Cuenta` };
}

export default async function PrivacyPage() {
  const t = await getTranslations('legal.privacy');
  const common = await getTranslations('legal.common');
  const { supportAddress, testStage } = publicStage();
  return (
    <LegalPage
      title={t('title')}
      lead={t('lead')}
      version={PRIVACY_VERSION}
      testStage={testStage}
      contact={supportAddress}
      other={{ href: '/terms', label: common('toTerms') }}
      sections={[
        {
          title: t('keepTitle'),
          list: true,
          items: [
            t('keepAccount'),
            t('keepFiles'),
            t('keepChoices'),
            t('keepConsent'),
            t('keepSession'),
            t('keepSecurity'),
            t('keepLimits'),
            t('keepMonitoring'),
          ],
        },
        { title: t('whereTitle'), items: [t('where')] },
        { title: t('leavesTitle'), list: true, items: [t('leavesEmail'), t('leavesPwned'), t('leavesNone')] },
        {
          title: t('howLongTitle'),
          list: true,
          items: [t('howLongData'), t('howLongConsent'), t('howLongSession'), t('howLongSignUp'), t('howLongLogs')],
        },
        {
          title: t('removeTitle'),
          list: true,
          items: [t('removeExport'), t('removeErase'), t('removeDelete'), t('removeAsk', { contact: supportAddress })],
        },
      ]}
    />
  );
}
