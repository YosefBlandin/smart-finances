import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { expect, within } from 'storybook/test';
import { Field, SelectField } from './Field';

const KINDS = ['expense', 'income', 'transfer_out', 'refund'] as const;

function Showcase() {
  const t = useTranslations();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('expense');
  return (
    <>
      <Field label={t('auth.common.email')} type="email" placeholder={t('auth.common.sample')} autoComplete="email" />
      <Field label={t('auth.common.password')} type="password" hint={t('auth.signUp.passwordHint')} />
      <Field label={t('auth.resetConfirm.code')} inputMode="numeric" defaultValue="123450" error={t('auth.confirm.errWrong')} />
      <SelectField label={t('transactions.kind')} value={kind} onChange={setKind} options={KINDS.map((id) => ({ id, label: t(`txKinds.${id}`) }))} />
    </>
  );
}

const meta: Meta = { title: 'Primitives/Field', render: () => <Showcase />, parameters: { stack: 'column' } };
export default meta;
type Story = StoryObj;

export const States: Story = {};
export const StatesEs: Story = { globals: { locale: 'es' } };
export const StatesDark: Story = { globals: { theme: 'dark' } };
export const StatesEsDark: Story = { globals: { locale: 'es', theme: 'dark' } };

/** The error is tied to the input with aria-describedby and the input is invalid (AC-10). */
export const ErrorIsDescribed: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText('Code from your email');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription('That code doesn’t match. Check the digits and try again.');
  },
};
