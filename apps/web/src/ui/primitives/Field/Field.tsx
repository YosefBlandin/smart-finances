// Field: a labelled input whose hint and error are tied to it with aria-describedby, and aria-invalid while it has an
// error (AC-10). The error is a red note with an icon (D-63). SelectField is the same field around a React Aria select (D-141).
// React Aria's select always renders a hidden native select with a style attribute, which the content policy refuses in
// server HTML (style-src has no 'unsafe-inline'; in the browser React sets it through the CSSOM, which the policy allows).
// So the server renders the field as plain markup (label, the button with its value, hint, error, and a hidden input
// carrying the value for a form), and React Aria's select takes its place on first use: a press, or a key that opens a
// select, loads it (a pointer over the button or focus on it starts the load early), and it opens with its button focused.
// The field shows at once, with no skeleton and no layout shift (SF-171, owner decision on the SF-165 workaround), and no
// page's first load carries React Aria (D-190, T-WEB-17).
'use client';

import { forwardRef, lazy, Suspense, useId, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './Field.module.css';

export type FieldProps = {
  label: string;
  name?: string;
  type?: 'text' | 'email' | 'password' | 'search' | 'number';
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'numeric' | 'decimal' | 'search';
  placeholder?: string;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, name, type = 'text', value, defaultValue, onChange, hint, error, required, disabled, autoComplete, inputMode, placeholder },
  ref,
) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field} data-invalid={error ? true : undefined}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        className={styles.input}
        name={name}
        type={type}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange ? (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value) : undefined}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.error}>
          <Icon name="failed" />
          {error}
        </p>
      ) : null}
    </div>
  );
});

export type SelectOption<T extends string> = { id: T; label: string };

export type SelectFieldProps<T extends string> = {
  label: string;
  options: SelectOption<T>[];
  value?: T;
  onChange?: (value: T) => void;
  name?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
};

const load = () => import('./AriaSelectField');
const AriaSelectField = lazy(load);

// Keys that open a closed React Aria select from its button (Enter and Space press the button, so they arrive as a click).
const OPENING_KEYS = new Set(['ArrowDown', 'ArrowUp']);

export function SelectField<T extends string>(props: SelectFieldProps<T>) {
  const [used, setUsed] = useState(false);
  const plain = <ServerSelectField {...props} onUse={props.disabled ? undefined : () => setUsed(true)} />;
  if (!used) return plain;
  return (
    <Suspense fallback={plain}>
      <AriaSelectField {...(props as unknown as SelectFieldProps<string>)} openOnMount />
    </Suspense>
  );
}

/** The select as the server renders it: what React Aria's shows when closed, without its hidden native select. */
function ServerSelectField<T extends string>({
  label,
  options,
  value,
  name,
  hint,
  error,
  disabled,
  onUse,
}: SelectFieldProps<T> & { onUse?: () => void }) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const selected = options.find((option) => option.id === value);
  return (
    <div className={styles.field} data-invalid={error ? true : undefined}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <button
        type="button"
        className={styles.select}
        aria-haspopup="listbox"
        aria-expanded={false}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={describedBy}
        disabled={disabled}
        onPointerEnter={disabled ? undefined : () => void load()}
        onFocus={disabled ? undefined : () => void load()}
        onClick={onUse}
        onKeyDown={(event: KeyboardEvent) => {
          if (!OPENING_KEYS.has(event.key) || !onUse) return;
          event.preventDefault();
          onUse();
        }}
      >
        <span id={valueId} className={styles.value}>
          {selected?.label ?? ''}
        </span>
        <Icon name="chevronDown" />
      </button>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className={styles.error}>
          <Icon name="failed" />
          {error}
        </span>
      ) : null}
      {name ? <input type="hidden" name={name} value={value ?? ''} disabled={disabled} /> : null}
    </div>
  );
}
