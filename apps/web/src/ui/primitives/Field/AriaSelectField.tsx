// SelectField's React Aria select, loaded on first use (D-190, D-141). It focuses its button, then opens, so closing it
// gives the focus back to its button.
'use client';

import { useEffect, useRef, useState } from 'react';
import { Button as AriaButton, ListBox, ListBoxItem, Popover, Select, SelectValue, Text, Label } from 'react-aria-components';
import { Icon } from '../Icon/Icon';
import type { SelectFieldProps } from './Field';
import styles from './Field.module.css';

export default function AriaSelectField({
  label,
  options,
  value,
  onChange,
  name,
  hint,
  error,
  disabled,
  openOnMount,
}: SelectFieldProps<string> & { openOnMount?: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // The plain button it replaces had the press: focus moves to this button first, so the popover takes the focus from it
  // and gives it back on close.
  useEffect(() => {
    if (!openOnMount) return;
    button.current?.focus();
    setOpen(true);
  }, [openOnMount]);
  return (
    <Select
      className={styles.field}
      data-invalid={error ? true : undefined}
      selectedKey={value ?? null}
      onSelectionChange={(key) => {
        if (key !== null) onChange?.(String(key));
      }}
      name={name}
      isInvalid={Boolean(error)}
      isDisabled={disabled}
      isOpen={open}
      onOpenChange={setOpen}
    >
      <Label className={styles.label}>{label}</Label>
      <AriaButton ref={button} className={styles.select}>
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
