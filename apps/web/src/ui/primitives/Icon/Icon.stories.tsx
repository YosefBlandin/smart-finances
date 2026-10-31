import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { ICON_NAMES, Icon } from './Icon';

function Showcase() {
  const t = useTranslations();
  return (
    <>
      <p>
        <Icon name="calendar" size="lg" /> {t('shell.month')}
      </p>
      <p>
        <Icon name="language" size="lg" /> {t('shell.otherLanguage')}
      </p>
      <p>
        <Icon name="signOut" size="lg" /> {t('shell.signOut')}
      </p>
      <p>
        <Icon name="failed" label={t('imports.status.failed')} />
      </p>
      <p aria-hidden="true">
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </p>
    </>
  );
}

const meta: Meta = { title: 'Primitives/Icon', render: () => <Showcase /> };
export default meta;
type Story = StoryObj;

export const Set: Story = {};
export const SetEs: Story = { globals: { locale: 'es' } };
export const SetDark: Story = { globals: { theme: 'dark' } };
export const SetEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };
