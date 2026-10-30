import { getTranslations } from 'next-intl/server';

// Placeholder until PR 4 builds the screen. The heading comes first and takes focus after a navigation (AC-10).
export default async function OverviewPage() {
  const t = await getTranslations();
  return (
    <>
      <h1 tabIndex={-1}>{t('nav.dashboard')}</h1>
      <p>{t('overview.sub')}</p>
    </>
  );
}
