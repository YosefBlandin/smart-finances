'use client';

import { useTranslations } from 'next-intl';
import type { Suggestion } from '@/domain/suggest';
import { categoryName } from '../../overview/text';
import styles from '../Review.module.css';

// Suggestion chips (category-suggestions AC-1 to AC-4, AC-19): the pick first, then up to two other likely categories,
// each a button named by its translated category ("Accept Groceries", "Use Home"). A tap saves that category and
// approves the row in one save (D-19). The placeholder holds the same box, hidden, while suggestions can still arrive.

export function SuggestionChips({
  suggestion,
  onPick,
  disabled,
}: {
  suggestion: Suggestion;
  onPick: (category: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const categories = [suggestion.pick, ...suggestion.others];
  return (
    <div className={styles.chips} data-chips="ready">
      {categories.map((category, i) => {
        const name = categoryName(t, category);
        return (
          <button
            key={category}
            type="button"
            className={styles.chip}
            data-pick={i === 0 || undefined}
            aria-label={t(i === 0 ? 'review.suggest.accept' : 'review.suggest.use', { category: name })}
            disabled={disabled}
            onClick={() => onPick(category)}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

/** The chips' space, kept empty and hidden so chips that arrive later move nothing (AC-16, D-26). */
export function ChipsPlaceholder() {
  return <div className={styles.chips} data-chips="placeholder" aria-hidden="true" />;
}
