// Button: a plain <button> (D-141 keeps simple parts plain). Variants are data attributes (D-143). It spins only while its
// own action runs (D-128); while busy it stays focusable, says aria-busy and ignores presses so a form is not sent twice.
// The danger variant is red, only for buttons that erase data or delete the account (D-146).
import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './Button.module.css';

export type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'md' | 'sm';
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  type?: 'button' | 'submit' | 'reset';
  name?: string;
  value?: string;
  form?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  'aria-describedby'?: string;
  children: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', busy = false, disabled, icon, type = 'button', onClick, children, ...rest },
  ref,
) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      ref={ref}
      type={type}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      data-busy={busy || undefined}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      disabled={disabled}
      onClick={handleClick}
      {...rest}
    >
      {busy ? (
        <span className={styles.spinner} data-spinner="">
          <Icon name="loader" />
        </span>
      ) : icon ? (
        <Icon name={icon} />
      ) : null}
      <span>{children}</span>
    </button>
  );
});
