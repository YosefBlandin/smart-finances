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
import { applyChoice, applyChoices, applyLabel, undoChoice, undoLabel } from './model';
import styles from './Review.module.css';
import { AcceptAll, type AcceptAllConfirm } from './suggest/AcceptAll';
import { saveAll, type SaveChoice } from './suggest/pool';
import { useSuggestions } from './suggest/useSuggestions';
import { CHOICE_SOURCE, ReviewView, type ReviewChoice } from './View';

// The review island (SF-166; D-131): the server prefetched the rows. A choice shows at once (the row takes its category,
// or leaves the list when approved), then the server action saves it; a refusal puts that row back as it was, leaving
// any other choice in flight as shown, and says so in plain words. Once the last choice in flight settles, the rows to review and the totals are asked again, and the
// server render is refreshed so the shell's to-review count follows (D-44).
// A recipient label (mercadopago-enrichment D-7, D-13) counts as an approval (D-131): every row with its key leaves at
// once and comes back on a refusal. It shares the choices' mutation key, so neither refetch undoes the other; after a
// saved label the totals are asked once more 5 s later, since the API rebuilds them on its own.
// Accept all (category-suggestions D-25) confirms a snapshot first, then saves it 4 at a time under the same in-flight
// guard; failed rows come back with their suggestions and one settle runs at the end. Its confirmation closes on any
// single choice, label or change to the list, and the other buttons wait while it runs.

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
  const [confirm, setConfirm] = useState<(AcceptAllConfirm & { choices: SaveChoice[] }) | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const [wait, setWait] = useState<number | undefined>(undefined);
  // Up to 4 saves can wait at once: the line shows the longest wait left, not whichever reported last.
  const waitUntil = useRef(0);
  const onWait = (secondsLeft: number) => {
    waitUntil.current = Math.max(waitUntil.current, Date.now() + secondsLeft * 1_000);
    setWait(Math.ceil((waitUntil.current - Date.now()) / 1_000));
  };
  const saveOnce = useRef(false);
  // Any change to the review list closes the confirmation, with nothing saved (D-25).
  useEffect(() => setConfirm(null), [query.data]);
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
      setConfirm(null);
      setFailedCount(0);
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
      setConfirm(null);
      setFailedCount(0);
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

  const runner = useMutation({
    mutationKey: MUTATION,
    // saveAll never rejects: it resolves with the ids that did not save (D-25).
    mutationFn: (choices: SaveChoice[]) => saveAll(choices, (c) => choose(c), { onWait }),
    onMutate: async (choices) => {
      clearTimeout(settleTimer.current);
      waitUntil.current = 0;
      setFailed(false);
      setFailedCount(0);
      await client.cancelQueries({ queryKey: dataKeys.review() });
      const before = client.getQueryData<ReviewReply>(dataKeys.review());
      if (before) client.setQueryData<ReviewReply>(dataKeys.review(), applyChoices(before, choices));
      // Every accepted row teaches the page (AC-11); a failed one takes its example back out.
      const tokens = new Map<string, number>();
      for (const c of choices) {
        const row = before?.items.find((r) => r.id === c.id);
        if (row) tokens.set(c.id, suggestions.add(row.id, row, c.category));
      }
      return { before, tokens };
    },
    onSuccess: (failedIds, _choices, context) => {
      const before = context?.before;
      if (before && failedIds.length > 0) {
        client.setQueryData<ReviewReply>(dataKeys.review(), (shown) => failedIds.reduce((list, id) => undoChoice(list, before, id), shown ?? before));
      }
      for (const id of failedIds) {
        const token = context?.tokens.get(id);
        if (token !== undefined) suggestions.remove(token);
      }
      setFailedCount(failedIds.length);
    },
    onSettled: () => {
      waitUntil.current = 0;
      setWait(undefined);
      settle();
      // The saving line leaves with the run: when nothing is left, or the line still holds focus, focus goes to the page
      // heading rather than the page body (the failure note is announced on its own).
      const left = client.getQueryData<ReviewReply>(dataKeys.review())?.items.length ?? 0;
      const lineHasFocus = document.activeElement instanceof HTMLElement && document.activeElement.dataset.saving !== undefined;
      if (left === 0 || lineHasFocus) document.querySelector<HTMLElement>('h1')?.focus();
    },
  });
  const running = runner.isPending;

  /** Accept all's first tap: a snapshot of every listed row with a pick, with its per-category tally (AC-6). */
  function openConfirm() {
    const rows = query.data?.items ?? [];
    const choices: SaveChoice[] = rows.flatMap((r) => {
      const s = suggestions.state.byRow.get(r.id);
      return s ? [{ id: r.id, date: r.date, category: s.pick, approved: true as const }] : [];
    });
    const counts = new Map<string, number>();
    for (const c of choices) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    saveOnce.current = false;
    setFailedCount(0);
    setConfirm({ choices, total: choices.length, tally: [...counts].map(([category, n]) => ({ category, n })) });
  }

  /** Save works once; rows no longer on the list are dropped from the snapshot before anything is sent (D-25). */
  function saveConfirmed() {
    if (saveOnce.current || !confirm) return;
    saveOnce.current = true;
    const listed = new Set((client.getQueryData<ReviewReply>(dataKeys.review())?.items ?? []).map((r) => r.id));
    const choices = confirm.choices.filter((c) => listed.has(c.id));
    setConfirm(null);
    if (choices.length > 0) runner.mutate(choices);
  }

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
  const withPick = query.data.items.filter((r) => suggestions.state.byRow.has(r.id)).length;
  const bar = (
    <AcceptAll
      // Hidden for the visit when a history range failed (D-24).
      count={suggestions.state.complete ? withPick : 0}
      confirm={confirm ?? undefined}
      saving={running ? { n: runner.variables?.length ?? 0, waitSeconds: wait } : undefined}
      failedCount={failedCount}
      onOpen={openConfirm}
      onCancel={() => setConfirm(null)}
      onSave={saveConfirmed}
    />
  );
  if (query.data.items.length === 0) {
    // While Accept all runs, its saving line stays; the empty state waits for its settle.
    if (running) return bar;
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
    <>
      {bar}
      {/* While Accept all runs, the single-choice, chip and label buttons wait (D-25). */}
      <div inert={running}>
        <ReviewView
          rows={query.data.items}
          failed={failed}
          suggest={{ ...suggestions.state, disabled: running }}
          onChoose={(choice) => {
            if (!running) mutation.mutate(choice);
          }}
          onLabel={
            label
              ? async (saved) =>
                  running
                    ? { ok: false, messageKey: 'label.saveFailed' }
                    : labeling.mutateAsync(saved).then(
                        () => ({ ok: true }) as const,
                        () => ({ ok: false, messageKey: 'label.saveFailed' }) as const,
                      )
              : undefined
          }
        />
      </div>
    </>
  );
}
