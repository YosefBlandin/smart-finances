/* eslint-disable import/no-restricted-paths -- the suggestion stories read fixtures/suggest.json through the in-memory
   data API, as memory.stories.tsx does (D-129, D-138); no production screen imports an adapter. */
import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, fn, userEvent, within } from 'storybook/test';
import suggest from '../../../fixtures/suggest.json';
import { MemoryClock } from '@/adapters/memory/clock';
import { fixtureSeed, MemoryDataApi, type ExtraFixture } from '@/adapters/memory/data-api';
import { examplesFrom, type HistoryRow } from '@/domain/suggest';
import { dataKeys } from '@/queries/keys';
import { data, memoryApi, settled, STORY_NOW, storyClient, StoryPage, type Asking, type Loaded, type StoryData } from '../memory.stories';
import { Review, type ChooseResult } from './Review';

// To review states (architecture.md "Screen states"; SF-171): the rows to review, where Mercado Pago rows offer a
// category and Approve and rows from other sources point to their file (partial); a refused choice rolled back with a
// plain message (D-131); nothing to review (empty); could not load (failed); loading. Each in English and Spanish,
// light and dark. Then the suggestion states (category-suggestions SF-11), in English and Spanish, on the fixtures plus
// fixtures/suggest.json with its history as the page would read it: suggestions loading, chips, no pick, confirming,
// saving, partial failure, and history failed (chips but no Accept all).

async function load(which: StoryData | 'none', asking: Asking = 'never') {
  if (which === 'none') return { client: storyClient(asking) };
  const { api, token } = memoryApi(which);
  return { client: storyClient(asking, [[dataKeys.review(), await data(api.review(token))]]) };
}

/** The history the page reads, as it would: suggest.json's rows that are not to review, as examples. */
const HISTORY = examplesFrom(
  (suggest as ExtraFixture).transactions
    .filter((t) => !suggest.reviewRows.includes(t.id))
    .map((t): HistoryRow => ({
      id: t.id,
      source: t.source,
      merchant: t.merchant,
      recipient_key: t.recipient_key ?? '',
      kind: t.kind,
      category: t.category,
      date: t.date,
      review: { approved: t.review?.approved ?? false, ...(t.review?.category_override ? { category_override: t.review.category_override } : {}) },
    })),
);

/** Suggestion states: the review list with suggest.json's rows, and the history done, partial, empty or still loading. */
async function loadSuggest(history: 'complete' | 'partial' | 'empty' | 'loading') {
  const api = new MemoryDataApi(new MemoryClock(STORY_NOW));
  const token = 'storybook-suggest-token-not-a-secret';
  api.allowToken(token);
  api.seed(fixtureSeed(suggest as ExtraFixture));
  const entries: [readonly unknown[], unknown][] = [[dataKeys.review(), await data(api.review(token))]];
  if (history !== 'loading') entries.push([dataKeys.history(), { examples: history === 'empty' ? [] : HISTORY, complete: history !== 'partial' }]);
  return { client: storyClient('never', entries) };
}

const choose = fn(async (): Promise<ChooseResult> => ({ ok: true }));
const refuse = fn(async (): Promise<ChooseResult> => ({ ok: false, messageKey: 'review.saveFailed' }));
/** Saves that never answer, so the saving line stays. */
const hold = fn((): Promise<ChooseResult> => new Promise<ChooseResult>(() => {}));
/** Every third save is refused, so some rows come back. */
let calls = 0;
const someFail = fn(async (): Promise<ChooseResult> => ((calls += 1) % 3 === 0 ? { ok: false, messageKey: 'review.saveFailed' } : { ok: true }));
const CHOOSE = { ok: choose, refused: refuse, hold, someFail } as const;

function Screen({ loaded, saves }: Loaded & { saves: keyof typeof CHOOSE }) {
  const t = useTranslations();
  return (
    <StoryPage client={loaded.client} title={t('nav.review')} lead={t('review.sub')}>
      <Review choose={CHOOSE[saves]} />
    </StoryPage>
  );
}

const meta: Meta = {
  title: 'Screens/Review',
  parameters: { nextjs: { appDirectory: true }, stack: 'column' },
  render: (args, ctx) => (
    <Screen loaded={(ctx as unknown as Loaded).loaded} saves={args.refused ? 'refused' : ((args.saves as keyof typeof CHOOSE | undefined) ?? 'ok')} />
  ),
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

const ACCEPT = /^(Accept|Aceptar) /;
const ACCEPT_ALL = /^(Accept all|Aceptar todo) \(/;
const SAVE = /^(Save and approve|Guardar y aprobar)$/;

/** Opens Accept all's confirmation and checks its tally. */
async function confirmAll(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: ACCEPT_ALL }));
  await expect(await canvas.findByRole('button', { name: SAVE })).toBeVisible();
  await expect(canvas.getAllByText(/^\d+ (as|como) /).length).toBeGreaterThan(0);
}

/** Suggestions loading: each payments row keeps the chips' height free until the history is read. */
export const SuggestionsLoading: Story = {
  loaders: [() => loadSuggest('loading')],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-chips="placeholder"]').length).toBeGreaterThan(0);
    await expect(canvasElement.querySelectorAll('[data-chips="ready"]')).toHaveLength(0);
  },
};
export const SuggestionsLoadingEs: Story = { ...SuggestionsLoading, globals: ES };

/** Chips: the pick first, then up to two others, with Accept all above the table. */
export const Chips: Story = {
  loaders: [() => loadSuggest('complete')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByRole('button', { name: ACCEPT })).length).toBeGreaterThan(0);
    await expect(canvas.getByRole('button', { name: ACCEPT_ALL })).toBeVisible();
  },
};
export const ChipsEs: Story = { ...Chips, globals: ES };

/** No pick: with no history to go on, a row the import rules do not place shows the picker and Approve only. */
export const NoPick: Story = {
  loaders: [() => loadSuggest('empty')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelectorAll('[data-chips="placeholder"]')).toHaveLength(0);
    const row = canvas.getAllByRole('row').find((r) => within(r).queryByText('Comercio Nuevo Sin Historia A'))!;
    await expect(row.querySelectorAll('[data-chips]')).toHaveLength(0);
    await expect(within(row).getByRole('button', { name: /^(Approve|Aprobar)$/ })).toBeVisible();
  },
};
export const NoPickEs: Story = { ...NoPick, globals: ES };

/** Confirming: Accept all's first tap shows the count and the per-category tally, with Save and Cancel. */
export const Confirming: Story = {
  loaders: [() => loadSuggest('complete')],
  play: async ({ canvasElement }) => confirmAll(canvasElement),
};
export const ConfirmingEs: Story = { ...Confirming, globals: ES };

/** Saving: after Save the rows leave at once and the saving line holds focus until every save answers. */
export const Saving: Story = {
  args: { saves: 'hold' },
  loaders: [() => loadSuggest('complete')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await confirmAll(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: SAVE }));
    await expect(await canvas.findByText(/^(Saving|Guardando) \d+ /)).toBeVisible();
  },
};
export const SavingEs: Story = { ...Saving, globals: ES };

/** Partial failure: the rows that did not save come back with their suggestions, and a note counts them. */
export const PartialFailure: Story = {
  args: { saves: 'someFail' },
  loaders: [() => loadSuggest('complete')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    calls = 0;
    await confirmAll(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: SAVE }));
    await expect(await canvas.findByRole('alert', {}, { timeout: 5_000 })).toBeVisible();
  },
};
export const PartialFailureEs: Story = { ...PartialFailure, globals: ES };

/** History failed: a history read failed after its retry, so single chips still show but Accept all does not. */
export const HistoryFailed: Story = {
  loaders: [() => loadSuggest('partial')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByRole('button', { name: ACCEPT })).length).toBeGreaterThan(0);
    await expect(canvas.queryByRole('button', { name: ACCEPT_ALL })).toBeNull();
  },
};
export const HistoryFailedEs: Story = { ...HistoryFailed, globals: ES };
