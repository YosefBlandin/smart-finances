'use client';

import { CATEGORIES } from '@smart-finances/contracts/categories';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/ui/primitives/Button/Button';
import { Field, SelectField } from '@/ui/primitives/Field/Field';
import { Note } from '@/ui/primitives/Note/Note';
import { categoryName } from '../overview/text';
import styles from './LabelForm.module.css';

// Label this recipient (mercadopago-enrichment D-7, D-13, D-22; Components "Web screens"): one name and one category for
// every row with the recipient key, past and future, which also approves them. The name starts as the shown merchant
// (1 to 80 characters after trimming); the category select never offers Uncategorized. Field errors are tied to their
// field with aria-describedby and the form's message is role=alert (web-ui architecture "Accessibility"); the select is
// the React Aria SelectField (web-ui D-141). The save button spins and ignores presses while saving. Names render as
// text only.

/** The categories a label may set: every category but Uncategorized (Contracts "Label item"). */
export const LABEL_CATEGORIES: readonly string[] = CATEGORIES.filter((c) => c !== 'Uncategorized');
export const NAME_MAX = 80;

export type RecipientLabel = { key: string; name: string; category: string };
export type LabelResult = { ok: true } | { ok: false; messageKey: string };

export type LabelFormProps = {
  recipientKey: string;
  /** The shown merchant, the name's starting value. */
  name: string;
  /** The row's shown category; preselected unless it is Uncategorized. */
  category: string;
  saving: boolean;
  /** The last save was refused; the form says so and keeps what was typed. */
  refused: boolean;
  /** Field errors from the start, for a story of the invalid state. */
  checked?: boolean;
  onSave: (label: RecipientLabel) => void;
  onCancel: () => void;
};

export function LabelForm({
  recipientKey,
  name: shownName,
  category: shownCategory,
  saving,
  refused,
  checked = false,
  onSave,
  onCancel,
}: LabelFormProps) {
  const t = useTranslations();
  const titleId = useId();
  const [name, setName] = useState(shownName);
  const [category, setCategory] = useState(LABEL_CATEGORIES.includes(shownCategory) ? shownCategory : '');
  const [tried, setTried] = useState(checked);
  const trimmed = name.trim();
  const nameError = !tried
    ? undefined
    : !trimmed
      ? t('label.nameRequired')
      : trimmed.length > NAME_MAX
        ? t('label.nameTooLong', { n: NAME_MAX })
        : undefined;
  const categoryError = tried && !LABEL_CATEGORIES.includes(category) ? t('label.categoryRequired') : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (saving || !trimmed || trimmed.length > NAME_MAX || !LABEL_CATEGORIES.includes(category)) return;
    onSave({ key: recipientKey, name: trimmed, category });
  };
  return (
    <form className={styles.form} aria-labelledby={titleId} onSubmit={submit} noValidate>
      <p id={titleId} className={styles.title}>
        {t('label.title')}
      </p>
      <p className={styles.lead}>{t('label.lead')}</p>
      {refused ? (
        <Note tone="error" role="alert">
          {t('label.saveFailed')}
        </Note>
      ) : null}
      <Field label={t('label.name')} value={name} onChange={setName} error={nameError} autoComplete="off" />
      <SelectField
        label={t('label.category')}
        value={category}
        options={LABEL_CATEGORIES.map((c) => ({ id: c, label: categoryName(t, c) }))}
        onChange={setCategory}
        error={categoryError}
      />
      <div className={styles.actions}>
        <Button type="submit" size="sm" variant="primary" busy={saving}>
          {t('label.save')}
        </Button>
        <Button size="sm" onClick={onCancel} disabled={saving}>
          {t('label.cancel')}
        </Button>
      </div>
    </form>
  );
}

export type LabelControlProps = {
  recipientKey: string;
  name: string;
  category: string;
  /** Saves the label; the control waits for the answer, closes on success and says so on a refusal. */
  onSave: (label: RecipientLabel) => Promise<LabelResult>;
};

/** "Label this recipient": a button that opens the form under it (a disclosure, aria-expanded and aria-controls). */
export function LabelControl({ recipientKey, name, category, onSave }: LabelControlProps) {
  const t = useTranslations();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState(false);
  const save = async (label: RecipientLabel) => {
    setSaving(true);
    setRefused(false);
    const result = await onSave(label).catch((): LabelResult => ({ ok: false, messageKey: 'label.saveFailed' }));
    setSaving(false);
    if (result.ok) setOpen(false);
    else setRefused(true);
  };
  return (
    <div className={styles.control}>
      <button type="button" className={styles.open} aria-expanded={open} aria-controls={formId} onClick={() => setOpen((o) => !o)}>
        {t('label.open')}
      </button>
      {open ? (
        <div id={formId}>
          <LabelForm
            recipientKey={recipientKey}
            name={name}
            category={category}
            saving={saving}
            refused={refused}
            onSave={(label) => void save(label)}
            onCancel={() => {
              setOpen(false);
              setRefused(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
