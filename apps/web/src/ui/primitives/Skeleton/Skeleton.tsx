// Skeleton: a grey placeholder for content that is loading (D-128). Hidden from screen readers; the block around it
// says "Loading" once (StateBlock). It pulses unless reduced motion is asked for.
import styles from './Skeleton.module.css';

export type SkeletonProps = {
  width?: 'full' | 'wide' | 'half' | 'short';
  height?: 'text' | 'title' | 'block';
};

export function Skeleton({ width = 'full', height = 'text' }: SkeletonProps) {
  return <span className={styles.skeleton} data-width={width} data-height={height} aria-hidden="true" />;
}
