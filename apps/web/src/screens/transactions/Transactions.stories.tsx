import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, within } from 'storybook/test';
import { dataKeys, PAGE_SIZE } from '@/queries/keys';
import { data, memoryApi, settled, storyClient, StoryPage, STORY_MONTH, type Asking, type Loaded } from '../memory.stories';
import { filtersOf, type Address } from './model';
import { Transactions } from './Transactions';

// Transactions states (architecture.md "Screen states"; SF-171): a month's first page (50 rows, newest first, with the
// next page button), a filter that shows the hostile synthetic rows as plain text (AC-9), nothing matches (empty),
// could not load (failed) and loading. Each in English and Spanish, light and dark.

type Shape = { address: Address; asking?: Asking; prefetch?: boolean };

async function load({ address, asking = 'never', prefetch = true }: Shape) {
  if (!prefetch) return { client: storyClient(asking), address };
  const { api, token } = memoryApi();
  const first = await data(
    api.listTransactions(token, {
      from: address.month,
      to: address.month,
      ...(address.kind ? { kind: address.kind } : {}),
      ...(address.category ? { category: address.category } : {}),
      sort: address.sort,
      order: address.order,
      limit: PAGE_SIZE,
    }),
  );
  return { client: storyClient(asking, [[dataKeys.transactions(filtersOf(address)), { pages: [first], pageParams: [undefined] }]]), address };
}

type Shown = Loaded & { loaded: { address: Address } };

function Screen({ loaded }: Shown) {
  const t = useTranslations();
  return (
    <StoryPage client={loaded.client} title={t('nav.transactions')} lead={t('transactions.sub')}>
      <Transactions address={loaded.address} now={STORY_MONTH} />
    </StoryPage>
  );
}

const meta: Meta = {
  title: 'Screens/Transactions',
  parameters: { nextjs: { appDirectory: true }, stack: 'column' },
  render: (_args, ctx) => <Screen loaded={(ctx as unknown as Shown).loaded} />,
};
export default meta;
type Story = StoryObj;

const ES = { locale: 'es' } as const;
const DARK = { theme: 'dark' } as const;
const ES_DARK = { locale: 'es', theme: 'dark' } as const;
const NEWEST: Pick<Address, 'sort' | 'order'> = { sort: 'date', order: 'desc' };

/** A month's first page: 50 rows, newest first, and the button for the next page. */
export const Month: Story = {
  loaders: [() => load({ address: { month: '2026-09', ...NEWEST } })],
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('row')).toHaveLength(PAGE_SIZE + 1);
  },
};
export const MonthEs: Story = { ...Month, globals: ES };
export const MonthDark: Story = { ...Month, globals: DARK };
export const MonthEsDark: Story = { ...Month, globals: ES_DARK };

/** Filtered to one category: the hostile synthetic rows show as plain text, nothing in them runs (AC-9). */
export const HostileRowsAsText: Story = {
  loaders: [() => load({ address: { month: '2026-05', category: 'Uncategorized', ...NEWEST } })],
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
    await expect(canvasElement.querySelectorAll('img, [onerror]')).toHaveLength(0);
  },
};
export const HostileRowsAsTextEs: Story = { ...HostileRowsAsText, globals: ES };
export const HostileRowsAsTextDark: Story = { ...HostileRowsAsText, globals: DARK };
export const HostileRowsAsTextEsDark: Story = { ...HostileRowsAsText, globals: ES_DARK };

/** Empty: nothing matches this month and filter; it says so and points to other months. */
export const NothingMatches: Story = {
  loaders: [() => load({ address: { month: STORY_MONTH, ...NEWEST } })],
  play: async ({ canvasElement }) => settled(canvasElement, 'empty'),
};
export const NothingMatchesEs: Story = { ...NothingMatches, globals: ES };
export const NothingMatchesDark: Story = { ...NothingMatches, globals: DARK };
export const NothingMatchesEsDark: Story = { ...NothingMatches, globals: ES_DARK };

/** Failed: the list could not load; it says so with a retry. */
export const Failed: Story = {
  loaders: [() => load({ address: { month: '2026-09', ...NEWEST }, asking: 'fails', prefetch: false })],
  play: async ({ canvasElement }) => settled(canvasElement, 'error'),
};
export const FailedEs: Story = { ...Failed, globals: ES };
export const FailedDark: Story = { ...Failed, globals: DARK };
export const FailedEsDark: Story = { ...Failed, globals: ES_DARK };

/** Loading: skeletons where the list goes. */
export const Loading: Story = { loaders: [() => load({ address: { month: '2026-09', ...NEWEST }, prefetch: false })] };
export const LoadingEs: Story = { ...Loading, globals: ES };
export const LoadingDark: Story = { ...Loading, globals: DARK };
export const LoadingEsDark: Story = { ...Loading, globals: ES_DARK };
