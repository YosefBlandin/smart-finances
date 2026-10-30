// Field: a labelled input whose hint and error are tied to it with aria-describedby, and aria-invalid while it has an
// error (AC-10). The error is a red note with an icon (D-63). SelectField is the same field around a React Aria select (D-141).
'use client';

import { forwardRef, useId, type ChangeEvent } from 'react';
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

export function SelectField<T extends string>({ label, options, value, onChange, name, hint, error, disabled }: SelectFieldProps<T>) {
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
