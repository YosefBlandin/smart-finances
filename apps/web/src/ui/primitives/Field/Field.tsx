// Field: a labelled input whose hint and error are tied to it with aria-describedby, and aria-invalid while it has an
// error (AC-10). The error is a red note with an icon (D-63). SelectField is the same field around a React Aria select (D-141).
// React Aria's select always renders a hidden native select with a style attribute, which the content policy refuses in
// server HTML (style-src has no 'unsafe-inline'; in the browser React sets it through the CSSOM, which the policy allows).
// So the server and the hydration pass render the same field as plain markup (label, the button with its value, hint,
// error, and a hidden input carrying the value for a form), and React Aria's select takes its place once hydrated: the
// field shows at once, with no skeleton and no layout shift (SF-171, owner decision on the SF-165 workaround).
'use client';

import { forwardRef, useId, useSyncExternalStore, type ChangeEvent } from 'react';
import { Button as AriaButton, ListBox, ListBoxItem, Popover, Select, SelectValue, Text, Label } from 'react-aria-components';
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

const noSubscribe = () => () => {};
/** False on the server and during hydration, true after it (and on any client-only render). */
const useHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

export function SelectField<T extends string>(props: SelectFieldProps<T>) {
  return useHydrated() ? <AriaSelectField {...props} /> : <ServerSelectField {...props} />;
}

/** The select as the server renders it: what React Aria's shows when closed, without its hidden native select. */
function ServerSelectField<T extends string>({ label, options, value, name, hint, error, disabled }: SelectFieldProps<T>) {
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

function AriaSelectField<T extends string>({ label, options, value, onChange, name, hint, error, disabled }: SelectFieldProps<T>) {
  return (
    <Select
      className={styles.field}
      data-invalid={error ? true : undefined}
      selectedKey={value ?? null}
      onSelectionChange={(key) => {
        if (key !== null) onChange?.(String(key) as T);
      }}
      name={name}
      isInvalid={Boolean(error)}
      isDisabled={disabled}
    >
      <Label className={styles.label}>{label}</Label>
      <AriaButton className={styles.select}>
        <SelectValue className={styles.value} />
        <Icon name="chevronDown" />
      </AriaButton>
      {hint ? (
        <Text slot="description" className={styles.hint}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text slot="errorMessage" className={styles.error}>
          <Icon name="failed" />
          {error}
        </Text>
      ) : null}
      <Popover className={styles.popover}>
        <ListBox className={styles.listbox}>
          {options.map((option) => (
            <ListBoxItem key={option.id} id={option.id} className={styles.option}>
              {option.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}
