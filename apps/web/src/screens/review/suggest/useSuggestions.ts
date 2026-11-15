'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { addChoice, buildIndex, suggest, type ModelScorer, type Suggestion, type SuggestRow } from '@/domain/suggest';
import type { History } from '@/queries/data';

// The review page's suggestions (category-suggestions AC-1, AC-11, D-11, D-26): the history examples plus every choice
// and label made on this page, kept only in React state for the visit, ranked by the suggest module. A refused choice
// takes its example back out. Suggestions show only once the history read has settled; while a model can still arrive,
// rows with no pick keep their space.

export type SuggestState = {
  /** The suggestion of each payments row with a pick, keyed by row id. */
  byRow: Map<string, Suggestion>;
  /** The history read has settled (ready or partial), so chips may show. */
  settled: boolean;
  /** Every history range was read; Accept all is hidden for the visit otherwise (D-24). */
  complete: boolean;
  /** A model shipped and is neither ready nor off yet. */
  modelPending: boolean;
};

type Choice = { token: number; id: string; row: SuggestRow; category: string };
type HistoryQuery = { data?: History; status: 'pending' | 'error' | 'success' };
type Model = { scorer?: ModelScorer; pending: boolean };

export function useSuggestions(rows: SuggestRow[] | undefined, history: HistoryQuery, model: Model = { pending: false }) {
  const [choices, setChoices] = useState<Choice[]>([]);
  const next = useRef(0);
  const examples = history.data?.examples;
  const index = useMemo(() => choices.reduce((built, c) => addChoice(built, c.row, c.category), buildIndex(examples ?? [])), [examples, choices]);
  const settled = history.status !== 'pending';
  const byRow = useMemo(
    () => (settled && rows ? suggest(rows, index, model.scorer) : new Map<string, Suggestion>()),
    [settled, rows, index, model.scorer],
  );

  /** Adds a choice for the page; a later choice for the same row (or label key) replaces it. Returns its token. */
  const add = useCallback((id: string, row: SuggestRow, category: string): number => {
    next.current += 1;
    const token = next.current;
    setChoices((list) => [...list.filter((c) => c.id !== id), { token, id, row, category }]);
    return token;
  }, []);
  /** Takes a refused choice back out. */
  const remove = useCallback((token: number) => setChoices((list) => list.filter((c) => c.token !== token)), []);

  const state: SuggestState = { byRow, settled, complete: settled && Boolean(history.data?.complete), modelPending: model.pending };
  return { state, add, remove };
}
