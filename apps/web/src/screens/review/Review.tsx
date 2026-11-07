'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useReview } from '@/queries/data';
import { dataKeys, type ReviewReply } from '@/queries/keys';
import { StateBlock } from '@/ui/patterns/StateBlock/StateBlock';
import { applyChoice, undoChoice } from './model';
import styles from './Review.module.css';
import { ReviewView, type ReviewChoice } from './View';

// The review island (SF-166; D-131): the server prefetched the rows. A choice shows at once (the row takes its category,
// or leaves the list when approved), then the server action saves it; a refusal puts that row back as it was, leaving
// any other choice in flight as shown, and says so in plain words. Once the last choice in flight settles, the rows to review and the totals are asked again, and the
// server render is refreshed so the shell's to-review count follows (D-44).

export type ChooseResult = { ok: true } | { ok: false; messageKey: string };
export type ReviewProps = { choose: (choice: ReviewChoice) => Promise<ChooseResult> };

const MUTATION = ['review-choice'] as const;

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
    onError: (_error, choice, context) => {
      // Only this choice comes back; another choice still in flight stays shown.
      const before = context?.before;
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), (shown) => (shown ? undoChoice(shown, before, choice.id) : before));
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
