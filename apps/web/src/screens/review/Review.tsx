'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useHistory, useReview } from '@/queries/data';
import { dataKeys, type ReviewReply } from '@/queries/keys';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import type { RecipientLabel } from '../label/LabelForm';
import { applyChoice, applyLabel, undoChoice, undoLabel } from './model';
import styles from './Review.module.css';
import { useSuggestions } from './suggest/useSuggestions';
import { CHOICE_SOURCE, ReviewView, type ReviewChoice } from './View';

// The review island (SF-166; D-131): the server prefetched the rows. A choice shows at once (the row takes its category,
// or leaves the list when approved), then the server action saves it; a refusal puts that row back as it was, leaving
// any other choice in flight as shown, and says so in plain words. Once the last choice in flight settles, the rows to review and the totals are asked again, and the
// server render is refreshed so the shell's to-review count follows (D-44).
// A recipient label (mercadopago-enrichment D-7, D-13) counts as an approval (D-131): every row with its key leaves at
// once and comes back on a refusal. It shares the choices' mutation key, so neither refetch undoes the other; after a
// saved label the totals are asked once more 5 s later, since the API rebuilds them on its own.

/** retryAfterSeconds: the action's wait after a refusal for too many requests (category-suggestions D-25). */
export type ChooseResult = { ok: true } | { ok: false; messageKey: string; retryAfterSeconds?: number };
export type ReviewProps = {
  choose: (choice: ReviewChoice) => Promise<ChooseResult>;
  label?: (label: RecipientLabel) => Promise<ChooseResult>;
};

/** The in-flight guard: review choices and labels share it. */
export const MUTATION = ['review-choice'] as const;
/** After a saved label, the totals are asked again once the API's rebuild has had time to run (D-13). */
export const LABEL_TOTALS_AGAIN_MS = 5_000;
/** After single choices and labels, the list is asked again once, this long after the last settles (category-suggestions D-27). */
export const SETTLE_AFTER_MS = 2_000;
const UNCATEGORIZED = 'Uncategorized';

export function Review({ choose, label }: ReviewProps) {
  const t = useTranslations();
  const client = useQueryClient();
  const router = useRouter();
  const query = useReview();
  // Suggestions (category-suggestions AC-1, AC-11): history read once per visit, plus every choice and label made here.
  const history = useHistory(query.data?.items);
  const suggestions = useSuggestions(query.data?.items, history);
  const [failed, setFailed] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settleTimer.current), []);
  const mutation = useMutation({
    mutationKey: MUTATION,
    mutationFn: async (choice: ReviewChoice) => {
      const result = await choose(choice);
      if (!result.ok) throw new Error(result.messageKey);
    },
    onMutate: async (choice) => {
      clearTimeout(settleTimer.current);
      setFailed(false);
      await client.cancelQueries({ queryKey: dataKeys.review() });
      const before = client.getQueryData<ReviewReply>(dataKeys.review());
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), applyChoice(before, choice));
      // The choice teaches the other rows at once (AC-11): its category, or the row's own when it is approved as is.
      const row = before?.items.find((r) => r.id === choice.id);
      const category = choice.category ?? row?.category;
      const token = row && category && category !== UNCATEGORIZED ? suggestions.add(row.id, row, category) : undefined;
      return { before, token };
    },
    onError: (_error, choice, context) => {
      // Only this choice comes back; another choice still in flight stays shown.
      const before = context?.before;
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), (shown) => (shown ? undoChoice(shown, before, choice.id) : before));
      if (context?.token !== undefined) suggestions.remove(context.token);
      setFailed(true);
    },
    onSettled: () => settleLater(),
  });
  const labeling = useMutation({
    mutationKey: MUTATION,
    mutationFn: async (saved: RecipientLabel) => {
      if (!label) throw new Error('label.saveFailed');
      const result = await label(saved);
      if (!result.ok) throw new Error(result.messageKey);
    },
    onMutate: async (saved) => {
      clearTimeout(settleTimer.current);
      setFailed(false);
      await client.cancelQueries({ queryKey: dataKeys.review() });
      const before = client.getQueryData<ReviewReply>(dataKeys.review());
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), applyLabel(before, saved.key));
      // A label teaches the rows with its key and name too (AC-11).
      const kind = before?.items.find((r) => r.recipient_key === saved.key)?.kind ?? 'expense';
      const labelled = {
        id: `label:${saved.key}`,
        source: CHOICE_SOURCE,
        merchant: saved.name,
        recipient_key: saved.key,
        kind,
        category: saved.category,
      };
      const token = suggestions.add(labelled.id, labelled, saved.category);
      return { before, token };
    },
    onError: (_error, saved, context) => {
      const before = context?.before;
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), (shown) => (shown ? undoLabel(shown, before, saved.key) : before));
      if (context?.token !== undefined) suggestions.remove(context.token);
      setFailed(true);
    },
    onSuccess: () => {
      setTimeout(() => void client.invalidateQueries({ queryKey: [...dataKeys.all, 'totals'] }), LABEL_TOTALS_AGAIN_MS);
    },
    onSettled: () => settleLater(),
  });

  /**
   * Single choices and labels settle once, SETTLE_AFTER_MS after the last one in flight settles; a new one restarts the
   * wait (D-27), so a fast pass costs one counted request a row plus one refetch at the end (RK-9).
   */
  function settleLater() {
    if (client.isMutating({ mutationKey: MUTATION }) > 1) return;
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (client.isMutating({ mutationKey: MUTATION }) > 0) return;
      settle();
    }, SETTLE_AFTER_MS);
  }

  function settle() {
    // Only after the last choice or label in flight, so an answer for an earlier one cannot undo a later one on screen.
    if (client.isMutating({ mutationKey: MUTATION }) > 1) return;
    void client.invalidateQueries({ queryKey: dataKeys.review() });
    void client.invalidateQueries({ queryKey: [...dataKeys.all, 'totals'] });
    void client.invalidateQueries({ queryKey: [...dataKeys.all, 'transactions'] });
    router.refresh();
  }

  if (!query.data) {
    if (query.error && !query.isFetching) {
      return <StateBlock kind="error" title={t('states.errT')} text={t('states.errB')} onRetry={() => void query.refetch()} />;
    }
    return <StateBlock kind="loading" lines={6} />;
  }
  if (query.data.items.length === 0) {
    return (
      <StateBlock
        kind="empty"
        title={t('states.empty.review.title')}
        text={t('states.empty.review.text')}
        action={
          <Link href="/imports" className={styles.go}>
            {t('overview.todoImportsGo')}
          </Link>
        }
      />
    );
  }
  return (
    <ReviewView
      rows={query.data.items}
      failed={failed}
      suggest={suggestions.state}
      onChoose={(choice) => mutation.mutate(choice)}
      onLabel={
        label
          ? async (saved) =>
              labeling.mutateAsync(saved).then(
                () => ({ ok: true }) as const,
                () => ({ ok: false, messageKey: 'label.saveFailed' }) as const,
              )
          : undefined
      }
    />
  );
}
