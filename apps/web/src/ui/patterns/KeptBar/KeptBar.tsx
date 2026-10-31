// KeptBar: the earned-against-spent bar inside the overview's colour field (D-26, D-27). Hand-drawn SVG (D-57), so the
// shares are SVG attributes, not inline styles. The part that is the answer (kept, or the overspend) is solid at the right
// end; the marker shows the typical month or where earnings ran out. One image with one sentence for screen readers.
import styles from './KeptBar.module.css';

export type KeptBarProps = {
  /** The colour field the bar sits on: good (green), bad (ink), none (neutral). */
  field?: 'good' | 'bad' | 'none';
  /** The sentence a screen reader hears, e.g. "You spent 68% of what you earned and kept 32%." */
  label: string;
  /** Share of the bar that is solid at the right end, 0 to 1. */
  solid: number;
  /** Where the marker sits from the left, 0 to 1; none when null or left out. */
  marker?: number | null;
  markerLabel?: string;
  start: { label: string; value: string };
  end: { label: string; value: string };
};

const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, n)) * 1000) / 10}%`;

export function KeptBar({ field = 'good', label, solid, marker, markerLabel, start, end }: KeptBarProps) {
  const share = Math.min(1, Math.max(0, solid));
  const hasMarker = typeof marker === 'number';
  const left = hasMarker && marker < 0.5;
  return (
    <div className={styles.bar} data-field={field} role="img" aria-label={label}>
      <svg className={styles.svg} width="100%" height="64" aria-hidden="true">
        <rect className={styles.track} x="0" y="26" width="100%" height="12" rx="4" />
        <rect className={styles.solid} data-part="solid" x={pct(1 - share)} y="26" width={pct(share)} height="12" rx="4" />
        {hasMarker ? (
          <>
            <line className={styles.ring} x1={pct(marker)} x2={pct(marker)} y1="20" y2="44" />
            <line className={styles.marker} data-part="marker" x1={pct(marker)} x2={pct(marker)} y1="20" y2="44" />
            {markerLabel ? (
              <text className={styles.text} x={pct(marker)} dx={left ? 8 : -8} y="12" textAnchor={left ? 'start' : 'end'}>
                {markerLabel}
              </text>
            ) : null}
          </>
        ) : null}
        <text className={styles.text} x="0" y="60" textAnchor="start">
          {start.label} <tspan className={styles.strong}>{start.value}</tspan>
        </text>
        <text className={styles.text} x="100%" y="60" textAnchor="end">
          {end.label} <tspan className={styles.strong}>{end.value}</tspan>
        </text>
      </svg>
    </div>
  );
}
