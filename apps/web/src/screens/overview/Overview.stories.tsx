import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, userEvent, within } from 'storybook/test';
import { dataKeys } from '@/queries/keys';
import { data, memoryApi, settled, storyClient, StoryPage, STORY_MONTH, type Asking, type Loaded, type StoryData } from '../memory.stories';
import { placesFilters, totalsRange } from './model';
import { Overview } from './Overview';

// Overview states (architecture.md "Screen states"; SF-171): a good month, a bad month (red only on the overspend,
// AC-11), a month with no rate and fewer than three rated months (partial, D-85), no money in yet (empty), every
// section failed and one section failed alone (D-101), and loading (skeletons, as on an in-app navigation). Each in
// English and Spanish, light and dark.

type Shape = { data?: StoryData; month: string; asking?: Asking; prefetch?: 'all' | 'none' | 'no-places' };

async function load({ data: which = 'fixtures', month, asking = 'never', prefetch = 'all' }: Shape) {
  const range = totalsRange(month, STORY_MONTH);
  if (prefetch === 'none') return { client: storyClient(asking), range, month };
  const { api, token } = memoryApi(which);
  const f = placesFilters(month);
  const [totals, rates, review, imports, places] = await Promise.all([
    data(api.totals(token, range)),
    data(api.rates(token)),
    data(api.review(token)),
    data(api.listImports(token, {})),
    data(api.listTransactions(token, { from: month, to: month, kind: 'expense', sort: f.sort, order: f.order, limit: f.limit })),
  ]);
  const entries: [readonly unknown[], unknown][] = [
    [dataKeys.totals(range), totals],
    [dataKeys.rates(), rates],
    [dataKeys.review(), review],
    [dataKeys.imports(), imports],
  ];
  if (prefetch === 'all') entries.push([dataKeys.transactions(f), { pages: [places], pageParams: [undefined] }]);
  return { client: storyClient(asking, entries), range, month };
}

function Screen({ loaded }: Loaded & { loaded: { range: ReturnType<typeof totalsRange>; month: string } }) {
  const t = useTranslations();
  return (
    <StoryPage client={loaded.client} title={t('nav.dashboard')}>
      <Overview month={loaded.month} range={loaded.range} />
    </StoryPage>
  );
}

const meta: Meta = {
  title: 'Screens/Overview',
  parameters: { nextjs: { appDirectory: true }, stack: 'column' },
  render: (_args, ctx) => (
    <Screen loaded={(ctx as unknown as Loaded & { loaded: { range: ReturnType<typeof totalsRange>; month: string } }).loaded} />
  ),
};
export default meta;
type Story = StoryObj;

const ES = { locale: 'es' } as const;
const DARK = { theme: 'dark' } as const;
const ES_DARK = { locale: 'es', theme: 'dark' } as const;

/** A good month: kept against the typical month, the waiting line, where it went, over time, the biggest places. */
export const GoodMonth: Story = { loaders: [() => load({ month: '2026-09' })] };
export const GoodMonthEs: Story = { ...GoodMonth, globals: ES };
export const GoodMonthDark: Story = { ...GoodMonth, globals: DARK };
export const GoodMonthEsDark: Story = { ...GoodMonth, globals: ES_DARK };

/** A bad month: the overspend is the one red figure on the screen (AC-11). */
export const BadMonth: Story = {
  loaders: [() => load({ month: '2026-03' })],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-money][data-tone="bad"]')).toHaveLength(1);
  },
};
export const BadMonthEs: Story = { ...BadMonth, globals: ES };
export const BadMonthDark: Story = { ...BadMonth, globals: DARK };
export const BadMonthEsDark: Story = { ...BadMonth, globals: ES_DARK };

/** Partial: a month with no dollar rate yet, which says so and offers to add it. */
export const NoRate: Story = { loaders: [() => load({ month: '2026-10' })] };
export const NoRateEs: Story = { ...NoRate, globals: ES };
export const NoRateDark: Story = { ...NoRate, globals: DARK };
export const NoRateEsDark: Story = { ...NoRate, globals: ES_DARK };

/** Partial: fewer than three rated months, so there is no typical month yet and no comparison sentence (D-85). */
export const FewRatedMonths: Story = { loaders: [() => load({ data: 'two-rates', month: '2026-09' })] };
export const FewRatedMonthsEs: Story = { ...FewRatedMonths, globals: ES };
export const FewRatedMonthsDark: Story = { ...FewRatedMonths, globals: DARK };
export const FewRatedMonthsEsDark: Story = { ...FewRatedMonths, globals: ES_DARK };

/** Empty: no money in yet, with the way to the first import. */
export const Empty: Story = { loaders: [() => load({ data: 'empty', month: STORY_MONTH })] };
export const EmptyEs: Story = { ...Empty, globals: ES };
export const EmptyDark: Story = { ...Empty, globals: DARK };
export const EmptyEsDark: Story = { ...Empty, globals: ES_DARK };

/** Failed: every read failed; each section says so with its own retry (D-101). */
export const Failed: Story = {
  loaders: [() => load({ month: '2026-09', asking: 'fails', prefetch: 'none' })],
  play: async ({ canvasElement }) => settled(canvasElement, 'error'),
};
export const FailedEs: Story = { ...Failed, globals: ES };
export const FailedDark: Story = { ...Failed, globals: DARK };
export const FailedEsDark: Story = { ...Failed, globals: ES_DARK };

/** Failed alone: the places read failed; only its section says so, and Try again asks again. */
export const PlacesFailed: Story = {
  loaders: [() => load({ month: '2026-09', asking: 'fails', prefetch: 'no-places' })],
  play: async ({ canvasElement }) => {
    await settled(canvasElement, 'error', 1);
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Try again|Reintentar/ }));
    await settled(canvasElement, 'error', 1);
  },
};
export const PlacesFailedEs: Story = { ...PlacesFailed, globals: ES };
export const PlacesFailedDark: Story = { ...PlacesFailed, globals: DARK };
export const PlacesFailedEsDark: Story = { ...PlacesFailed, globals: ES_DARK };

/** Loading: skeletons in each section, as on an in-app navigation (D-101, D-128). */
export const Loading: Story = { loaders: [() => load({ month: '2026-09', prefetch: 'none' })] };
export const LoadingEs: Story = { ...Loading, globals: ES };
export const LoadingDark: Story = { ...Loading, globals: DARK };
export const LoadingEsDark: Story = { ...Loading, globals: ES_DARK };
