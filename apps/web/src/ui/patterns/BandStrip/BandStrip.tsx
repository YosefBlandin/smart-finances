// BandStrip: this month's spending, one band per category as wide as its share (D-15, D-25). Hand-drawn SVG (D-57):
// widths are SVG attributes, never inline styles. Thin surface lines give the bands their texture; the strip is one image
// with one sentence, and each band names its category on hover.
import { useId } from 'react';
import type { CategoryColour } from '../../primitives/CategorySquare/CategorySquare';
import styles from './BandStrip.module.css';

export type Band = { cat: CategoryColour; share: number; name: string };

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export function BandStrip({ label, bands }: { label: string; bands: Band[] }) {
  const texture = `bands${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const total = bands.reduce((sum, b) => sum + Math.max(0, b.share), 0) || 1;
  let x = 0;
  const rects = bands.map((band) => {
    const width = Math.max(0, band.share) / total;
    const rect = { ...band, x, width };
    x += width;
    return rect;
  });
  return (
    <div className={styles.strip} role="img" aria-label={label}>
      <svg className={styles.svg} width="100%" height="44" aria-hidden="true">
        <defs>
          <pattern id={texture} width="4" height="4" patternUnits="userSpaceOnUse">
            <rect className={styles.gap} x="3" y="0" width="1" height="4" />
          </pattern>
        </defs>
        {rects.map((band, i) => (
          <rect key={i} className={styles.band} data-cat={String(band.cat)} x={pct(band.x)} y="0" width={pct(band.width)} height="44">
            <title>{band.name}</title>
          </rect>
        ))}
        <rect x="0" y="0" width="100%" height="44" fill={`url(#${texture})`} pointerEvents="none" />
      </svg>
    </div>
  );
}
