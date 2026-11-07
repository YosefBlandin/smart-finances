import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, fn, userEvent, within } from 'storybook/test';
import { dataKeys } from '@/queries/keys';
import { data, memoryApi, settled, storyClient, StoryPage, type Asking, type Loaded, type StoryData } from '../memory.stories';
import { Review, type ChooseResult } from './Review';

// To review states (architecture.md "Screen states"; SF-171): the rows to review, where Mercado Pago rows offer a
// category and Approve and rows from other sources point to their file (partial); a refused choice rolled back with a
// plain message (D-131); nothing to review (empty); could not load (failed); loading. Each in English and Spanish,
// light and dark.

async function load(which: StoryData | 'none', asking: Asking = 'never') {
  if (which === 'none') return { client: storyClient(asking) };
  const { api, token } = memoryApi(which);
  return { client: storyClient(asking, [[dataKeys.review(), await data(api.review(token))]]) };
}

const choose = fn(async (): Promise<ChooseResult> => ({ ok: true }));
const refuse = fn(async (): Promise<ChooseResult> => ({ ok: false, messageKey: 'review.saveFailed' }));

function Screen({ loaded, refused }: Loaded & { refused?: boolean }) {
  const t = useTranslations();
  return (
    <StoryPage client={loaded.client} title={t('nav.review')} lead={t('review.sub')}>
      <Review choose={refused ? refuse : choose} />
    </StoryPage>
  );
}

const meta: Meta = {
  title: 'Screens/Review',
  parameters: { nextjs: { appDirectory: true }, stack: 'column' },
  render: (args, ctx) => <Screen loaded={(ctx as unknown as Loaded).loaded} refused={Boolean(args.refused)} />,
};
export default meta;
type Story = StoryObj;

const ES = { locale: 'es' } as const;
const DARK = { theme: 'dark' } as const;
const ES_DARK = { locale: 'es', theme: 'dark' } as const;

/** The rows to review; rows from a source other than Mercado Pago say to fix them in their file (partial). */
export const Rows: Story = { loaders: [() => load('fixtures')] };
export const RowsEs: Story = { ...Rows, globals: ES };
export const RowsDark: Story = { ...Rows, globals: DARK };
export const RowsEsDark: Story = { ...Rows, globals: ES_DARK };

/** A refused approval comes back with a plain message, and the row stays (D-131). */
export const ChoiceRefused: Story = {
  args: { refused: true },
  loaders: [() => load('fixtures')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getAllByRole('row').length;
    await userEvent.click(canvas.getAllByRole('button', { name: /^(Approve|Aprobar)$/ })[0]!);
    await expect(await canvas.findByRole('alert')).toBeVisible();
    await expect(canvas.getAllByRole('row')).toHaveLength(rows);
  },
};
export const ChoiceRefusedEs: Story = { ...ChoiceRefused, globals: ES };
export const ChoiceRefusedDark: Story = { ...ChoiceRefused, globals: DARK };
export const ChoiceRefusedEsDark: Story = { ...ChoiceRefused, globals: ES_DARK };

/** Empty: nothing to review, with the way to the imports. */
export const NothingToReview: Story = { loaders: [() => load('empty')], play: async ({ canvasElement }) => settled(canvasElement, 'empty') };
export const NothingToReviewEs: Story = { ...NothingToReview, globals: ES };
export const NothingToReviewDark: Story = { ...NothingToReview, globals: DARK };
export const NothingToReviewEsDark: Story = { ...NothingToReview, globals: ES_DARK };

/** Failed: the list could not load; it says so with a retry. */
export const Failed: Story = { loaders: [() => load('none', 'fails')], play: async ({ canvasElement }) => settled(canvasElement, 'error') };
export const FailedEs: Story = { ...Failed, globals: ES };
export const FailedDark: Story = { ...Failed, globals: DARK };
export const FailedEsDark: Story = { ...Failed, globals: ES_DARK };

/** Loading: skeletons where the list goes. */
export const Loading: Story = { loaders: [() => load('none')] };
export const LoadingEs: Story = { ...Loading, globals: ES };
export const LoadingDark: Story = { ...Loading, globals: DARK };
export const LoadingEsDark: Story = { ...Loading, globals: ES_DARK };
