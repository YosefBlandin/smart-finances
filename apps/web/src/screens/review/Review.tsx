'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useReview } from '@/queries/data';
import { dataKeys, type ReviewReply } from '@/queries/keys';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import styles from './Review.module.css';
import { ReviewView, type ReviewChoice } from './View';

// The review island (SF-166; D-131): the server prefetched the rows. A choice shows at once (the row takes its category,
// or leaves the list when approved), then the server action saves it; a refusal puts the list back as it was and says
// so in plain words. Once the last choice in flight settles, the rows to review and the totals are asked again, and the
// server render is refreshed so the shell's to-review count follows (D-44).

export type ChooseResult = { ok: true } | { ok: false; messageKey: string };
export type ReviewProps = { choose: (choice: ReviewChoice) => Promise<ChooseResult> };

const MUTATION = ['review-choice'] as const;

/** The list with the choice applied: an approved row leaves it, a category is shown on its row. */
export function applyChoice(reply: ReviewReply, choice: ReviewChoice): ReviewReply {
  if (choice.approved) return { ...reply, items: reply.items.filter((row) => row.id !== choice.id) };
  return { ...reply, items: reply.items.map((row) => (row.id === choice.id && choice.category ? { ...row, category: choice.category } : row)) };
}

export function Review({ choose }: ReviewProps) {
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
    onError: (_error, _choice, context) => {
      if (context?.before) client.setQueryData(dataKeys.review(), context.before);
      setFailed(true);
    },
    onSettled: () => {
      // Only after the last choice in flight, so an answer for an earlier one cannot undo a later one on screen.
      if (client.isMutating({ mutationKey: MUTATION }) > 1) return;
      void client.invalidateQueries({ queryKey: dataKeys.review() });
      void client.invalidateQueries({ queryKey: [...dataKeys.all, 'totals'] });
      void client.invalidateQueries({ queryKey: [...dataKeys.all, 'transactions'] });
      router.refresh();
    },
  });

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
  return <ReviewView rows={query.data.items} failed={failed} onChoose={(choice) => mutation.mutate(choice)} />;
}
