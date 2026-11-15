// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
import { dataKeys, type ReviewReply, type Transaction } from '@/queries/keys';
import { applyLabel, undoLabel } from '../review/model';
import { MUTATION, Review, type ChooseResult } from '../review/Review';
import { ReviewView, type ReviewRow } from '../review/View';
import { ListView } from '../transactions/List/View';
import { LABEL_CATEGORIES, LabelForm } from './LabelForm';

// T-ENR-22, T-ENR-23 (mercadopago-enrichment AC-6, AC-7, D-7, D-22; web-ui D-131): the label control shows on review
// and transactions rows with a recipient key and nowhere else, never offers Uncategorized, removes the key's review rows
// at once, brings them back on a refusal and shares the review choices' in-flight guard. Synthetic rows and names only.

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const KEY = 'c'.repeat(32);
const OTHER = 'd'.repeat(32);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Intl({ children, locale = 'en' }: { children: ReactNode; locale?: 'en' | 'es' }) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

const reviewRow = (id: string, over: Partial<ReviewRow> = {}): ReviewRow => ({
  id,
  date: '2026-10-02',
  date_precision: 'day',
  kind: 'expense',
  amount: -1000,
  currency: 'ARS',
  category: 'Uncategorized',
  merchant: `Made-up ${id}`,
  recipient_key: '',
  description_raw: `SYNTHETIC ${id}`,
  source: 'mercadopago',
  source_ref: id,
  country: 'AR',
  flags: ['needs_review'],
  import_batch: 'b',
  reasons: ['needs_review'],
  ...over,
});
const txRow = (id: string, recipient_key = ''): Transaction => {
  const { reasons, ...rest } = reviewRow(id, { recipient_key });
  return { ...rest, review: { reasons, approved: false } };
};
const labelButtons = () => screen.queryAllByRole('button', { name: en.label.open });

describe('T-ENR-22: where the label control shows', () => {
  it('T-ENR-22: review rows with a recipient key offer it; rows without a key, and screens without the action, do not', () => {
    const rows = [reviewRow('a', { recipient_key: KEY }), reviewRow('b'), reviewRow('c', { source: 'csv' })];
    const { unmount } = render(
      <Intl>
        <ReviewView rows={rows} failed={false} onChoose={() => {}} onLabel={async () => ({ ok: true })} />
      </Intl>,
    );
    expect(labelButtons()).toHaveLength(1);
    expect(within(screen.getAllByRole('row')[1]!).getByRole('button', { name: en.label.open })).toBeTruthy();
    unmount();
    render(
      <Intl>
        <ReviewView rows={rows} failed={false} onChoose={() => {}} />
      </Intl>,
    );
    expect(labelButtons()).toHaveLength(0);
  });

  it('T-ENR-22: transactions rows with a recipient key offer it, under the place', () => {
    render(
      <Intl>
        <ListView
          rows={[txRow('a', KEY), txRow('b'), txRow('c', OTHER)]}
          address={{ month: '2026-10', view: 'list', sort: 'date', order: 'desc' } as never}
          pageSize={50}
          hasNext={false}
          loadingNext={false}
          onSort={() => {}}
          onNext={() => {}}
          onLabel={async () => ({ ok: true })}
        />
      </Intl>,
    );
    expect(labelButtons()).toHaveLength(2);
  });

  it('T-ENR-22: the form starts with the shown name, never offers Uncategorized, and ties each error to its field', () => {
    expect(LABEL_CATEGORIES).not.toContain('Uncategorized');
    expect(LABEL_CATEGORIES.length).toBeGreaterThan(20);
    const onSave = vi.fn();
    render(
      <Intl>
        <LabelForm
          recipientKey={KEY}
          name="Made-up Cafe"
          category="Uncategorized"
          saving={false}
          refused={false}
          onSave={onSave}
          onCancel={() => {}}
        />
      </Intl>,
    );
    const name = screen.getByLabelText(en.label.name) as HTMLInputElement;
    expect(name.value).toBe('Made-up Cafe');
    // An Uncategorized row starts with no category chosen; saving asks for one.
    fireEvent.click(screen.getByRole('button', { name: en.label.save }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(en.label.categoryRequired)).toBeTruthy();
    fireEvent.change(name, { target: { value: '   ' } });
    const error = screen.getByText(en.label.nameRequired);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toContain(error.id);
    fireEvent.change(name, { target: { value: 'x'.repeat(81) } });
    expect(screen.getByText(en.label.nameTooLong.replace('{n}', '80'))).toBeTruthy();
  });

  it('T-ENR-22: a valid form saves the trimmed name with the key and the category', () => {
    const onSave = vi.fn();
    render(
      <Intl>
        <LabelForm
          recipientKey={KEY}
          name="  Made-up Cafe "
          category="Dining out"
          saving={false}
          refused={false}
          onSave={onSave}
          onCancel={() => {}}
        />
      </Intl>,
    );
    fireEvent.click(screen.getByRole('button', { name: en.label.save }));
    expect(onSave).toHaveBeenCalledWith({ key: KEY, name: 'Made-up Cafe', category: 'Dining out' });
  });

  it('T-ENR-22: while saving the button says busy and ignores presses; a refusal is a role=alert message', () => {
    const onSave = vi.fn();
    render(
      <Intl locale="es">
        <LabelForm recipientKey={KEY} name="Made-up Cafe" category="Dining out" saving refused onSave={onSave} onCancel={() => {}} />
      </Intl>,
    );
    const save = screen.getByRole('button', { name: es.label.save });
    expect(save.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(es.label.saveFailed);
  });
});

describe('T-ENR-22: a name is text only (RK-1)', () => {
  it('T-ENR-22: markup in a merchant name renders as text on the row and in the form', () => {
    const name = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <Intl>
        <ReviewView
          rows={[reviewRow('a', { recipient_key: KEY, merchant: name })]}
          failed={false}
          onChoose={() => {}}
          onLabel={async () => ({ ok: true })}
        />
      </Intl>,
    );
    fireEvent.click(labelButtons()[0]!);
    expect(screen.getByText(name)).toBeTruthy();
    expect((screen.getByLabelText(en.label.name) as HTMLInputElement).value).toBe(name);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('T-ENR-23: saving a label on the review screen', () => {
  it('T-ENR-23: applyLabel removes every row with the key; undoLabel puts them back in place and keeps other changes', () => {
    const before: ReviewReply = { items: [reviewRow('a', { recipient_key: KEY }), reviewRow('b'), reviewRow('c', { recipient_key: KEY })] };
    const shown = applyLabel(before, KEY);
    expect(shown.items.map((r) => r.id)).toEqual(['b']);
    const changed = { items: [{ ...shown.items[0]!, category: 'Groceries' }] };
    expect(undoLabel(changed, before, KEY).items.map((r) => [r.id, r.category])).toEqual([
      ['a', 'Uncategorized'],
      ['b', 'Groceries'],
      ['c', 'Uncategorized'],
    ]);
  });

  it('T-ENR-23: the key’s rows leave at once, come back on a refusal, and the save counts in the choices’ in-flight guard', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => {})); // no refetch ever answers during the test
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData<ReviewReply>(dataKeys.review(), {
      items: [reviewRow('a', { recipient_key: KEY, category: 'Groceries' }), reviewRow('b'), reviewRow('c', { recipient_key: KEY })],
    });
    let answerLabel: (r: ChooseResult) => void = () => {};
    let answerChoice: (r: ChooseResult) => void = () => {};
    const label = vi.fn(() => new Promise<ChooseResult>((r) => (answerLabel = r)));
    const choose = vi.fn(() => new Promise<ChooseResult>((r) => (answerChoice = r)));
    render(
      <QueryClientProvider client={client}>
        <Intl>
          <Review choose={choose} label={label} />
        </Intl>
      </QueryClientProvider>,
    );
    const ids = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getByText(/SYNTHETIC/).textContent);
    expect(ids()).toEqual(['SYNTHETIC a', 'SYNTHETIC b', 'SYNTHETIC c']);

    fireEvent.click(labelButtons()[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.label.save }));
    });
    expect(label).toHaveBeenCalledWith({ key: KEY, name: 'Made-up a', category: 'Groceries' });
    await vi.waitFor(() => expect(ids()).toEqual(['SYNTHETIC b']));
    expect(client.isMutating({ mutationKey: MUTATION })).toBe(1);

    // A choice on b while the label is in flight: both count in one guard.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.review.approve }));
    });
    expect(client.isMutating({ mutationKey: MUTATION })).toBe(2);
    await vi.waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(0));

    // The label is refused: its rows come back in place, b stays approved away, and the screen says so.
    await act(async () => {
      answerLabel({ ok: false, messageKey: 'label.saveFailed' });
    });
    await vi.waitFor(() => expect(ids()).toEqual(['SYNTHETIC a', 'SYNTHETIC c']));
    expect(screen.getByRole('alert').textContent).toContain(en.review.saveFailed);
    await act(async () => {
      answerChoice({ ok: true });
    });
    expect(client.isMutating({ mutationKey: MUTATION })).toBe(0);
  });
});

describe('T-ENR-23: copy', () => {
  it('T-ENR-23: the label copy and the Your data line exist in English and Spanish with the same keys', () => {
    expect(Object.keys(es.label).sort()).toEqual(Object.keys(en.label).sort());
    for (const v of [...Object.values(en.label), ...Object.values(es.label)]) expect(v.trim().length).toBeGreaterThan(0);
    expect([en.data.sLabels, en.data.sLabelsD, es.data.sLabels, es.data.sLabelsD].every(Boolean)).toBe(true);
  });
});
