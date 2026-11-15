'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useReview } from '@/queries/data';
import { dataKeys, type ReviewReply } from '@/queries/keys';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import type { RecipientLabel } from '../label/LabelForm';
import { applyChoice, applyLabel, undoChoice, undoLabel } from './model';
import styles from './Review.module.css';
import { ReviewView, type ReviewChoice } from './View';

// The review island (SF-166; D-131): the server prefetched the rows. A choice shows at once (the row takes its category,
// or leaves the list when approved), then the server action saves it; a refusal puts that row back as it was, leaving
// any other choice in flight as shown, and says so in plain words. Once the last choice in flight settles, the rows to review and the totals are asked again, and the
// server render is refreshed so the shell's to-review count follows (D-44).
// A recipient label (mercadopago-enrichment D-7, D-13) counts as an approval (D-131): every row with its key leaves at
// once and comes back on a refusal. It shares the choices' mutation key, so neither refetch undoes the other; after a
// saved label the totals are asked once more 5 s later, since the API rebuilds them on its own.

export type ChooseResult = { ok: true } | { ok: false; messageKey: string };
export type ReviewProps = {
  choose: (choice: ReviewChoice) => Promise<ChooseResult>;
  label?: (label: RecipientLabel) => Promise<ChooseResult>;
};

/** The in-flight guard: review choices and labels share it. */
export const MUTATION = ['review-choice'] as const;
/** After a saved label, the totals are asked again once the API's rebuild has had time to run (D-13). */
export const LABEL_TOTALS_AGAIN_MS = 5_000;

export function Review({ choose, label }: ReviewProps) {
  const t = useTranslations();
  const client = useQueryClient();
  const router = useRouter();
  const query = useReview();
  const [failed, setFailed] = useState(false);
  const mutation = useMutation({
    mutationKey: MUTATION,
    mutationFn: async (choice: ReviewChoice) => {
      const result = await choose(choice);
      if (!result.ok) throw new Error(result.messageKey);
    },
    onMutate: async (choice) => {
      setFailed(false);
      await client.cancelQueries({ queryKey: dataKeys.review() });
      const before = client.getQueryData<ReviewReply>(dataKeys.review());
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), applyChoice(before, choice));
      return { before };
    },
    onError: (_error, choice, context) => {
      // Only this choice comes back; another choice still in flight stays shown.
      const before = context?.before;
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), (shown) => (shown ? undoChoice(shown, before, choice.id) : before));
      setFailed(true);
    },
    onSettled: () => settle(),
  });
  const labeling = useMutation({
    mutationKey: MUTATION,
    mutationFn: async (saved: RecipientLabel) => {
      if (!label) throw new Error('label.saveFailed');
      const result = await label(saved);
      if (!result.ok) throw new Error(result.messageKey);
    },
    onMutate: async (saved) => {
      setFailed(false);
      await client.cancelQueries({ queryKey: dataKeys.review() });
      const before = client.getQueryData<ReviewReply>(dataKeys.review());
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), applyLabel(before, saved.key));
      return { before };
    },
    onError: (_error, saved, context) => {
      const before = context?.before;
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), (shown) => (shown ? undoLabel(shown, before, saved.key) : before));
      setFailed(true);
    },
    onSuccess: () => {
      setTimeout(() => void client.invalidateQueries({ queryKey: [...dataKeys.all, 'totals'] }), LABEL_TOTALS_AGAIN_MS);
    },
    onSettled: () => settle(),
  });

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
