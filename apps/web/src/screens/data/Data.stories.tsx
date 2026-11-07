import type { Meta, StoryObj } from '@storybook/nextjs';
import { useTranslations } from 'next-intl';
import { expect, within } from 'storybook/test';
import { data, memoryApi, storyClient, StoryPage } from '../memory.stories';
import { ERASE_MESSAGES, type ErasePhase } from './model';
import { DataView } from './View';

// Your data states (architecture.md "Screen states"; SF-171): what is stored with the export and the erase offer; the
// DELETE dialog open; erasing (the button spins, D-128); the counts after an erase, from the memory adapter's own erase
// (AC-7); the erase may be unfinished, with Finish erasing (failed); refused while an import runs (blocked). The screen
// reads nothing, so it has no loading or empty state (SF-168). Each in English and Spanish, light and dark.

type Shape = { phase: ErasePhase; asking?: boolean; busy?: boolean };
type Shown = { loaded: { client: ReturnType<typeof storyClient> } & Shape };

async function erased(): Promise<Shape> {
  const { api, token } = memoryApi();
  return { phase: { kind: 'done', erased: (await data(api.erase(token, { confirm: 'DELETE' }))).deleted } };
}

function Screen({ loaded }: Shown) {
  const t = useTranslations();
  return (
    <StoryPage client={loaded.client} title={t('nav.data')} lead={t('data.sub')}>
      <DataView phase={loaded.phase} asking={Boolean(loaded.asking)} busy={Boolean(loaded.busy)} onAsk={() => {}} onErase={() => {}} />
    </StoryPage>
  );
}

const shape = (s: Shape) => async () => ({ client: storyClient('never'), ...s });

const meta: Meta = {
  title: 'Screens/Your data',
  parameters: { nextjs: { appDirectory: true }, stack: 'column' },
  render: (_args, ctx) => <Screen loaded={(ctx as unknown as Shown).loaded} />,
};
export default meta;
type Story = StoryObj;

const ES = { locale: 'es' } as const;
const DARK = { theme: 'dark' } as const;
const ES_DARK = { locale: 'es', theme: 'dark' } as const;

/** What is stored, the export, the erase offer and the way to delete the account. */
export const Offer: Story = { loaders: [shape({ phase: { kind: 'idle' } })] };
export const OfferEs: Story = { ...Offer, globals: ES };
export const OfferDark: Story = { ...Offer, globals: DARK };
export const OfferEsDark: Story = { ...Offer, globals: ES_DARK };

/** The dialog asks for the typed word DELETE and says backups keep the data 35 days (AC-7). */
export const AskingForDelete: Story = { loaders: [shape({ phase: { kind: 'idle' }, asking: true })] };
export const AskingForDeleteEs: Story = { ...AskingForDelete, globals: ES };
export const AskingForDeleteDark: Story = { ...AskingForDelete, globals: DARK };
export const AskingForDeleteEsDark: Story = { ...AskingForDelete, globals: ES_DARK };

/** Erasing: only the erase button spins (D-128). */
export const Erasing: Story = { loaders: [shape({ phase: { kind: 'idle' }, asking: true, busy: true })] };
export const ErasingEs: Story = { ...Erasing, globals: ES };
export const ErasingDark: Story = { ...Erasing, globals: DARK };
export const ErasingEsDark: Story = { ...Erasing, globals: ES_DARK };

/** Erased: the counts the erase answered (AC-7). */
export const Erased: Story = {
  loaders: [async () => ({ client: storyClient('never'), ...(await erased()) })],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).toMatch(/[0-9]/);
  },
};
export const ErasedEs: Story = { ...Erased, globals: ES };
export const ErasedDark: Story = { ...Erased, globals: DARK };
export const ErasedEsDark: Story = { ...Erased, globals: ES_DARK };

/** Failed: the erase may be unfinished; Finish erasing runs it again. */
export const Unfinished: Story = {
  loaders: [shape({ phase: { kind: 'unfinished' } })],
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /Finish erasing|Terminar de borrar/ })).toBeVisible();
  },
};
export const UnfinishedEs: Story = { ...Unfinished, globals: ES };
export const UnfinishedDark: Story = { ...Unfinished, globals: DARK };
export const UnfinishedEsDark: Story = { ...Unfinished, globals: ES_DARK };

/** Blocked: an import is running, so nothing is erased yet. */
export const ImportRunning: Story = { loaders: [shape({ phase: { kind: 'refused', messageKey: ERASE_MESSAGES.running } })] };
export const ImportRunningEs: Story = { ...ImportRunning, globals: ES };
export const ImportRunningDark: Story = { ...ImportRunning, globals: DARK };
export const ImportRunningEsDark: Story = { ...ImportRunning, globals: ES_DARK };
