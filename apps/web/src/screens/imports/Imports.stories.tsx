import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, fn, userEvent, within } from 'storybook/test';
import { dataKeys } from '@/queries/keys';
import { data, memoryApi, settled, storyClient, StoryPage, type Asking, type Loaded, type StoryData } from '../memory.stories';
import { ImportDetail } from './Detail';
import { Imports, type RequestResult } from './Imports';
import styles from './Imports.module.css';

// Imports states (architecture.md "Screen states"; SF-171): the list of imports; one import opened while it runs, after
// it stalled, when its file never arrived, done with skipped rows (D-86) and failed (partial); a file refused for its
// name, and a request refused by the daily cap or the pause switch (D-114); no imports yet (empty); could not load
// (failed); loading. Each in English and Spanish, light and dark.

async function load(which: StoryData | 'none', asking: Asking = 'never', open?: string) {
  if (which === 'none') return { client: storyClient(asking) };
  const { api, token } = memoryApi(which);
  const entries: [readonly unknown[], unknown][] = [[dataKeys.imports(), await data(api.listImports(token, {}))]];
  if (open) entries.push([dataKeys.import(open), await data(api.getImport(token, { id: open }))]);
  return { client: storyClient(asking, entries), open };
}

const requested = fn(async (): Promise<RequestResult> => ({ ok: false, messageKey: 'imports.refused.daily' }));
const paused = fn(async (): Promise<RequestResult> => ({ ok: false, messageKey: 'imports.refused.paused' }));
const unasked = fn(async (): Promise<RequestResult> => ({ ok: false, messageKey: 'imports.refused.failed' }));
const REQUESTS = { daily: requested, paused, unasked } as const;

type Shown = Loaded & { loaded: { open?: string } };

function Screen({ loaded, refusal }: Shown & { refusal?: keyof typeof REQUESTS }) {
  const t = useTranslations();
  return (
    <StoryPage client={loaded.client} title={t('nav.imports')} lead={t('imports.sub')}>
      {loaded.open ? (
        <div className={styles.screen}>
          <ImportDetail id={loaded.open} listed={undefined} />
        </div>
      ) : (
        <Imports request={REQUESTS[refusal ?? 'daily']} />
      )}
    </StoryPage>
  );
}

const meta: Meta = {
  title: 'Screens/Imports',
  parameters: { nextjs: { appDirectory: true }, stack: 'column' },
  render: (args, ctx) => <Screen loaded={(ctx as unknown as Shown).loaded} refusal={args.refusal as keyof typeof REQUESTS | undefined} />,
};
export default meta;
type Story = StoryObj;

const ES = { locale: 'es' } as const;
const DARK = { theme: 'dark' } as const;
const ES_DARK = { locale: 'es', theme: 'dark' } as const;

/** Sends one synthetic file through the file field (found by type, so the story reads the same in either language). */
async function send(canvasElement: HTMLElement, name: string, body = 'date,amount,description\n2026-11-02,-1000,SYNTHETIC SHOP\n') {
  const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, new File(body ? [body] : [], name, { type: 'text/csv' }));
}

/** The list of imports, newest first, each with its status. */
export const List: Story = { loaders: [() => load('fixtures')] };
export const ListEs: Story = { ...List, globals: ES };
export const ListDark: Story = { ...List, globals: DARK };
export const ListEsDark: Story = { ...List, globals: ES_DARK };

/** Partial: an import still running. */
export const Running: Story = { loaders: [() => load('fixtures', 'never', '01JBQ8Z4K2')] };
export const RunningEs: Story = { ...Running, globals: ES };
export const RunningDark: Story = { ...Running, globals: DARK };
export const RunningEsDark: Story = { ...Running, globals: ES_DARK };

/** Partial: an import that stalled. */
export const Stalled: Story = { loaders: [() => load('fixtures', 'never', '01J9V0Y7C1')] };
export const StalledEs: Story = { ...Stalled, globals: ES };
export const StalledDark: Story = { ...Stalled, globals: DARK };
export const StalledEsDark: Story = { ...Stalled, globals: ES_DARK };

/** Partial: an import whose file never arrived (expired). */
export const NeverArrived: Story = { loaders: [() => load('fixtures', 'never', '01J8KY2W5N')] };
export const NeverArrivedEs: Story = { ...NeverArrived, globals: ES };
export const NeverArrivedDark: Story = { ...NeverArrived, globals: DARK };
export const NeverArrivedEsDark: Story = { ...NeverArrived, globals: ES_DARK };

/** Partial: done with skipped rows, each with its reason in the importer's own words (D-86). */
export const SkippedRows: Story = {
  loaders: [() => load('fixtures', 'never', '01JA7R2M9X')],
  play: async ({ canvasElement }) => {
    // The importer's own words stay in English under the translated lead (D-86).
    await expect(within(canvasElement).getByText('amount is not a number')).toBeVisible();
  },
};
export const SkippedRowsEs: Story = { ...SkippedRows, globals: ES };
export const SkippedRowsDark: Story = { ...SkippedRows, globals: DARK };
export const SkippedRowsEsDark: Story = { ...SkippedRows, globals: ES_DARK };

/** An import that failed. */
export const ImportFailed: Story = { loaders: [() => load('fixtures', 'never', '01J8KZZ1QE')] };
export const ImportFailedEs: Story = { ...ImportFailed, globals: ES };
export const ImportFailedDark: Story = { ...ImportFailed, globals: DARK };
export const ImportFailedEsDark: Story = { ...ImportFailed, globals: ES_DARK };

/** Upload refused: a file the source's rules refuse (an empty one) says why, and nothing is asked. */
export const NameRefused: Story = {
  args: { refusal: 'unasked' },
  loaders: [() => load('fixtures')],
  play: async ({ canvasElement }) => {
    await send(canvasElement, 'release-report-2026-11.csv', '');
    await expect(await within(canvasElement).findByRole('alert')).toBeVisible();
    await expect(unasked).not.toHaveBeenCalled();
  },
};
export const NameRefusedEs: Story = { ...NameRefused, globals: ES };
export const NameRefusedDark: Story = { ...NameRefused, globals: DARK };
export const NameRefusedEsDark: Story = { ...NameRefused, globals: ES_DARK };

/** Blocked: the day's ten imports are used (D-114). */
export const DailyCap: Story = {
  args: { refusal: 'daily' },
  loaders: [() => load('fixtures')],
  play: async ({ canvasElement }) => {
    await send(canvasElement, 'release-report-2026-11.csv');
    await expect(await within(canvasElement).findByRole('alert')).toBeVisible();
  },
};
export const DailyCapEs: Story = { ...DailyCap, globals: ES };
export const DailyCapDark: Story = { ...DailyCap, globals: DARK };
export const DailyCapEsDark: Story = { ...DailyCap, globals: ES_DARK };

/** Blocked: imports are paused for everyone for now. */
export const Paused: Story = { ...DailyCap, args: { refusal: 'paused' } };
export const PausedEs: Story = { ...Paused, globals: ES };
export const PausedDark: Story = { ...Paused, globals: DARK };
export const PausedEsDark: Story = { ...Paused, globals: ES_DARK };

/** Empty: no imports yet. */
export const NoImports: Story = { loaders: [() => load('empty')], play: async ({ canvasElement }) => settled(canvasElement, 'empty') };
export const NoImportsEs: Story = { ...NoImports, globals: ES };
export const NoImportsDark: Story = { ...NoImports, globals: DARK };
export const NoImportsEsDark: Story = { ...NoImports, globals: ES_DARK };

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
