import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, fn, userEvent, within } from 'storybook/test';
import { dataKeys } from '@/queries/keys';
import { data, memoryApi, settled, storyClient, StoryPage, STORY_MONTH, type Asking, type Loaded, type StoryData } from '../memory.stories';
import { totalsRange } from '../overview/model';
import { Rates, type SaveResult } from './Rates';

// Dollar rates states (architecture.md "Screen states"; SF-171): the months with their rates, saved or missing; a
// refused rate that goes back to missing with a plain message (could not save, D-131); no months to rate (empty); could
// not load (failed); loading. Each in English and Spanish, light and dark.

const range = totalsRange(undefined, STORY_MONTH);

async function load(which: StoryData | 'none', asking: Asking = 'never') {
  if (which === 'none') return { client: storyClient(asking) };
  const { api, token } = memoryApi(which);
  const [rates, totals] = await Promise.all([data(api.rates(token)), data(api.totals(token, range))]);
  return {
    client: storyClient(asking, [
      [dataKeys.rates(), rates],
      [dataKeys.totals(range), totals],
    ]),
  };
}

const save = fn(async (): Promise<SaveResult> => ({ ok: true }));
const refuse = fn(async (): Promise<SaveResult> => ({ ok: false, messageKey: 'rates.saveFailed' }));

function Screen({ loaded, refused }: Loaded & { refused?: boolean }) {
  const t = useTranslations();
  return (
    <StoryPage client={loaded.client} title={t('rates.ratesTitle')} lead={t('rates.sub')}>
      <Rates range={range} save={refused ? refuse : save} />
    </StoryPage>
  );
}

const meta: Meta = {
  title: 'Screens/Rates',
  parameters: { nextjs: { appDirectory: true }, stack: 'column' },
  render: (args, ctx) => <Screen loaded={(ctx as unknown as Loaded).loaded} refused={Boolean(args.refused)} />,
};
export default meta;
type Story = StoryObj;

const ES = { locale: 'es' } as const;
const DARK = { theme: 'dark' } as const;
const ES_DARK = { locale: 'es', theme: 'dark' } as const;

/** Every month with money in it: its rate saved, or missing with a field to add it. */
export const Months: Story = { loaders: [() => load('fixtures')] };
export const MonthsEs: Story = { ...Months, globals: ES };
export const MonthsDark: Story = { ...Months, globals: DARK };
export const MonthsEsDark: Story = { ...Months, globals: ES_DARK };

/** Could not save: a refused rate goes back to missing with a plain message (D-131). */
export const SaveRefused: Story = {
  args: { refused: true },
  loaders: [() => load('fixtures')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getAllByRole('textbox')[0]!, '1450.50{Enter}');
    await expect(await canvas.findByRole('alert')).toBeVisible();
  },
};
export const SaveRefusedEs: Story = { ...SaveRefused, globals: ES };
export const SaveRefusedDark: Story = { ...SaveRefused, globals: DARK };
export const SaveRefusedEsDark: Story = { ...SaveRefused, globals: ES_DARK };

/** Empty: no months to rate yet. */
export const NoMonths: Story = { loaders: [() => load('empty')], play: async ({ canvasElement }) => settled(canvasElement, 'empty') };
export const NoMonthsEs: Story = { ...NoMonths, globals: ES };
export const NoMonthsDark: Story = { ...NoMonths, globals: DARK };
export const NoMonthsEsDark: Story = { ...NoMonths, globals: ES_DARK };

/** Failed: the rates could not load; it says so with a retry. */
export const Failed: Story = { loaders: [() => load('none', 'fails')], play: async ({ canvasElement }) => settled(canvasElement, 'error') };
export const FailedEs: Story = { ...Failed, globals: ES };
export const FailedDark: Story = { ...Failed, globals: DARK };
export const FailedEsDark: Story = { ...Failed, globals: ES_DARK };

/** Loading: skeletons where the months go. */
export const Loading: Story = { loaders: [() => load('none')] };
export const LoadingEs: Story = { ...Loading, globals: ES };
export const LoadingDark: Story = { ...Loading, globals: DARK };
export const LoadingEsDark: Story = { ...Loading, globals: ES_DARK };
