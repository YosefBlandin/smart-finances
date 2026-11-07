import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T-WEB-4 (AC-10, D-22, D-25): the design tokens carry the type, weight and spacing scales, and no category colour is the bad-news red.
const dir = fileURLToPath(new URL('.', import.meta.url));
const css = readFileSync(path.join(dir, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Split the file into its three top-level blocks: light, dark by system preference, dark by choice.
function block(opening: RegExp): Record<string, string> {
  const m = opening.exec(css);
  if (!m) throw new Error(`block not found: ${opening}`);
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < css.length && depth > 0; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
  const body = css.slice(start, i - 1);
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2]!.trim()]));
}
const light = block(/(?:^|\n):root\s*\{/);
const darkSystem = block(/:root:not\(\[data-theme=["']light["']\]\)\s*\{/);
const darkChosen = block(/:root\[data-theme=["']dark["']\]\s*\{/);
const themes = { light, 'dark (system)': { ...light, ...darkSystem }, 'dark (chosen)': { ...light, ...darkChosen } };

describe('T-WEB-4 tokens.css', () => {
  it('T-WEB-4 has the D-22 type sizes: 12, 14, 16, 20, 24, 32, 48 and one display size', () => {
    const rem = {
      '--t-xs': '0.75rem',
      '--t-s': '0.875rem',
      '--t-m': '1rem',
      '--t-l': '1.25rem',
      '--t-xl': '1.5rem',
      '--t-2xl': '2rem',
      '--t-3xl': '3rem',
    };
    for (const [name, value] of Object.entries(rem)) expect(light[name], name).toBe(value);
    expect(light['--t-display']).toMatch(/^clamp\(/);
  });

  it('T-WEB-4 has the weights 400, 500, 700 and 800 for the display figure only', () => {
    expect([light['--w-text'], light['--w-em'], light['--w-head'], light['--w-display']]).toEqual(['400', '500', '700', '800']);
  });

  it('T-WEB-4 has the 4px based spacing scale --s1 to --s7', () => {
    const px = ['4px', '8px', '12px', '16px', '24px', '32px', '48px'];
    px.forEach((value, i) => expect(light[`--s${i + 1}`], `--s${i + 1}`).toBe(value));
  });

  it.each(Object.entries(themes))('T-WEB-4 no category colour equals the bad-news red in %s', (_name, tokens) => {
    const bad = tokens['--bad']!.toLowerCase();
    expect(bad).toMatch(/^#/);
    for (let n = 1; n <= 12; n++) {
      const cat = tokens[`--cat${n}`];
      expect(cat, `--cat${n}`).toBeDefined();
      expect(cat!.toLowerCase(), `--cat${n}`).not.toBe(bad);
    }
  });

  it('T-WEB-4 sets the same dark colours whether dark comes from the system or from the toggle', () => {
    expect(darkSystem).toEqual(darkChosen);
    expect(Object.keys(darkSystem).length).toBeGreaterThan(30);
  });

  it('T-WEB-4 keeps the QR code the same in every theme', () => {
    expect(light['--qr-dark']).toBe('#000000');
    expect(light['--qr-light']).toBe('#ffffff');
    expect(darkSystem['--qr-dark']).toBeUndefined();
    expect(darkChosen['--qr-light']).toBeUndefined();
  });
});

describe('T-WEB-4 fonts and base styles', () => {
  const base = readFileSync(path.join(dir, 'base.css'), 'utf8');
  const fonts = readFileSync(path.join(dir, '..', 'app', 'fonts.ts'), 'utf8');

  it('T-WEB-4 points the font tokens at the bundled fonts, and keeps a fallback', () => {
    expect(base).toMatch(/--font-display:\s*var\(--font-chivo,\s*["']Chivo["']\)/);
    expect(base).toMatch(/--font-data:\s*var\(--font-chivo-mono,\s*["']Chivo Mono["']\)/);
  });

  it('T-WEB-4 loads Chivo 400, 500, 700, 800 and Chivo Mono 400, 500 from files that exist', () => {
    const files = [...fonts.matchAll(/path:\s*'([^']+\.woff2)'/g)].map((m) => m[1]!);
    expect(files.map((f) => path.basename(f)).sort()).toEqual(
      [
        'chivo-latin-400-normal.woff2',
        'chivo-latin-500-normal.woff2',
        'chivo-latin-700-normal.woff2',
        'chivo-latin-800-normal.woff2',
        'chivo-mono-latin-400-normal.woff2',
        'chivo-mono-latin-500-normal.woff2',
      ].sort(),
    );
    for (const f of files) expect(existsSync(path.join(dir, '..', 'app', f)), f).toBe(true);
    expect(fonts).toContain("variable: '--font-chivo'");
    expect(fonts).toContain("variable: '--font-chivo-mono'");
  });

  it('T-WEB-4 base styles use tokens only: no colour or size literals', () => {
    const code = base.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/font-size:\s*[\d.]+(px|rem)/);
  });
});
