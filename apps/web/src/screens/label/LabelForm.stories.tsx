import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, fn, userEvent, within } from 'storybook/test';
import { LabelForm, type LabelFormProps } from './LabelForm';

// Label this recipient (mercadopago-enrichment D-22; web-ui D-129): the form idle with the shown name, an invalid name
// with its field error, saving, and refused with the form's message. Each in English and Spanish, light and dark.
// Synthetic names and keys only.

const base: LabelFormProps = {
  recipientKey: 'e'.repeat(32),
  name: 'Made-up Cafe',
  category: 'Dining out',
  saving: false,
  refused: false,
  onSave: fn(),
  onCancel: fn(),
};

const meta: Meta<LabelFormProps> = {
  title: 'Screens/LabelForm',
  component: LabelForm,
  args: base,
};
export default meta;
type Story = StoryObj<LabelFormProps>;

const ES = { locale: 'es' } as const;
const DARK = { theme: 'dark' } as const;
const ES_DARK = { locale: 'es', theme: 'dark' } as const;

/** The form as it opens: the shown name and the row's category. */
export const Idle: Story = {};
export const IdleEs: Story = { globals: ES };
export const IdleDark: Story = { globals: DARK };
export const IdleEsDark: Story = { globals: ES_DARK };

/** An empty name: the field says so, tied to it, and nothing is saved. */
export const InvalidName: Story = {
  args: { name: '', category: 'Uncategorized', checked: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(canvas.getAllByRole('button')[0]!);
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};
export const InvalidNameEs: Story = { ...InvalidName, globals: ES };
export const InvalidNameDark: Story = { ...InvalidName, globals: DARK };
export const InvalidNameEsDark: Story = { ...InvalidName, globals: ES_DARK };

/** Saving: the save button spins and ignores presses. */
export const Saving: Story = { args: { saving: true } };
export const SavingEs: Story = { ...Saving, globals: ES };
export const SavingDark: Story = { ...Saving, globals: DARK };
export const SavingEsDark: Story = { ...Saving, globals: ES_DARK };

/** Refused: a plain message with role=alert; what was typed stays. */
export const Refused: Story = {
  args: { refused: true },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toBeVisible();
  },
};
export const RefusedEs: Story = { ...Refused, globals: ES };
export const RefusedDark: Story = { ...Refused, globals: DARK };
export const RefusedEsDark: Story = { ...Refused, globals: ES_DARK };
