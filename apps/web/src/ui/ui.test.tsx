// @vitest-environment jsdom
// The design-system parts as a whole (D-140 to D-143): red only where D-63 and D-146 allow it, the busy Button as the only
// spinner (D-128), field errors tied to their input (AC-10), no style attributes (the content policy has no 'unsafe-inline'),
// and stories for every part in both languages and both colour schemes (D-129, D-136).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import { BandStrip } from './patterns/BandStrip/BandStrip';
import { CategoryRow } from './patterns/CategoryRow/CategoryRow';
import { ConfirmDialog } from './patterns/ConfirmDialog/ConfirmDialog';
import { DataTable } from './patterns/DataTable/DataTable';
import { KeptBar } from './patterns/KeptBar/KeptBar';
import { MenuPanel } from './patterns/MenuPanel/MenuPanel';
import { MonthPicker } from './patterns/MonthPicker/MonthPicker';
import { StateBlock } from './patterns/StateBlock/StateBlock';
import { Button } from './primitives/Button/Button';
import { CategorySquare } from './primitives/CategorySquare/CategorySquare';
import { Chip } from './primitives/Chip/Chip';
import { Field, SelectField } from './primitives/Field/Field';
import { Icon } from './primitives/Icon/Icon';
import { Note } from './primitives/Note/Note';
import { Skeleton } from './primitives/Skeleton/Skeleton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const UI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(UI, '../..');
const PRIMITIVES = ['Button', 'Field', 'Chip', 'Note', 'Skeleton', 'CategorySquare', 'Icon'];
const PATTERNS = ['MonthPicker', 'DataTable', 'KeptBar', 'BandStrip', 'StateBlock', 'CategoryRow', 'MenuPanel', 'ConfirmDialog'];
const PARTS = [...PRIMITIVES.map((p) => ['primitives', p] as const), ...PATTERNS.map((p) => ['patterns', p] as const)];

function filesUnder(dir: string, test: (file: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full, test);
    return test(full) ? [full] : [];
  });
}

// Every CSS rule as [selector, declarations]; rules inside @media count with their own selector.
function rules(css: string): [string, string][] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!.trim()]);
}

const RED = /var\(--(bad|bad-soft|field-red)\)/;
// The only places red may appear among the parts: error notes and field errors, failed statuses (D-63), destructive buttons (D-146).
const RED_ALLOWED: Record<string, RegExp> = {
  'Button.module.css': /\[data-variant='danger'\]/,
  'Note.module.css': /\[data-tone='error'\]/,
  'Field.module.css': /\.error\b/,
  'Chip.module.css': /\[data-tone='failed'\]/,
};

const months = [
  { month: '2026-02', hasData: true, hasRate: true },
  { month: '2026-03', hasData: true, hasRate: true },
  { month: '2026-10', hasData: true, hasRate: false },
];

function withIntl(ui: ReactElement, locale: 'en' | 'es' = 'en') {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? es : en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

// One instance of every part, closed, as a server would render it.
const everyPart: [string, ReactElement][] = [
  ['Button', <Button key="b">Save</Button>],
  ['Field', <Field key="f" label="Email" hint="hint" error="error" />],
  ['SelectField', <SelectField key="s" label="Kind" value="a" options={[{ id: 'a', label: 'A' }]} />],
  [
    'Chip',
    <Chip key="c" tone="failed">
      Failed
    </Chip>,
  ],
  [
    'Note',
    <Note key="n" tone="error">
      Wrong
    </Note>,
  ],
  ['Skeleton', <Skeleton key="k" />],
  ['CategorySquare', <CategorySquare key="q" cat={3} />],
  ['Icon', <Icon key="i" name="info" />],
  ['MonthPicker', <MonthPicker key="m" months={months} value="2026-03" onChange={() => {}} />],
  [
    'DataTable',
    <DataTable.Root key="t" label="Rows">
      <DataTable.Header>
        <DataTable.Column>Date</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        <DataTable.Row>
          <DataTable.Cell>2026-03-01</DataTable.Cell>
        </DataTable.Row>
      </DataTable.Body>
    </DataTable.Root>,
  ],
  [
    'KeptBar',
    <KeptBar
      key="kb"
      label="Kept 32%"
      solid={0.32}
      marker={0.8}
      markerLabel="Typical"
      start={{ label: 'Spent', value: '68%' }}
      end={{ label: 'Kept', value: '32%' }}
    />,
  ],
  [
    'BandStrip',
    <BandStrip
      key="bs"
      label="Spending"
      bands={[
        { cat: 1, share: 0.6, name: 'Home' },
        { cat: 'other', share: 0.4, name: 'Everything else' },
      ]}
    />,
  ],
  ['StateBlock', <StateBlock key="sb" kind="empty" title="Nothing here" text="Import a file." />],
  [
    'CategoryRow',
    <CategoryRow.List key="cr" label="Where it went">
      <CategoryRow cat={2} name="Home" amount="ARS 1,000" share="40%" />
    </CategoryRow.List>,
  ],
  [
    'MenuPanel',
    <MenuPanel key="mp" label="Overview">
      {() => <p>Links</p>}
    </MenuPanel>,
  ],
  [
    'ConfirmDialog',
    <ConfirmDialog key="cd" isOpen={false} onOpenChange={() => {}} title="Delete" confirmLabel="Delete" onConfirm={() => {}} destructive>
      Body
    </ConfirmDialog>,
  ],
];

describe('T-WEB-9: red, busy and field errors across the parts', () => {
  it('T-WEB-9 error notes, field errors, failed chips and the danger Button use red; no other part rule does', () => {
    const cssFiles = filesUnder(UI, (f) => f.endsWith('.module.css'));
    expect(cssFiles.length).toBeGreaterThanOrEqual(15);
    const used = new Set<string>();
    for (const file of cssFiles) {
      const base = path.basename(file);
      for (const [selector, body] of rules(readFileSync(file, 'utf8'))) {
        if (!RED.test(body)) continue;
        const allowed = RED_ALLOWED[base];
        expect(allowed && allowed.test(selector), `${base}: "${selector}" uses red`).toBe(true);
        used.add(base);
      }
    }
    expect([...used].sort()).toEqual(Object.keys(RED_ALLOWED).sort());
  });

  it('T-WEB-9 no part sets red or a raw colour outside its CSS module, and CSS modules use tokens, not literal colours', () => {
    for (const file of filesUnder(UI, (f) => /\.tsx$/.test(f) && !f.endsWith('.test.tsx'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/--bad|--field-red|#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
    for (const file of filesUnder(UI, (f) => f.endsWith('.module.css'))) {
      expect(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });

  it('T-WEB-9 the danger Button renders its variant as data-variant, the default is secondary', () => {
    render(
      <>
        <Button variant="danger">Delete everything</Button>
        <Button>Cancel</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Delete everything' }).getAttribute('data-variant')).toBe('danger');
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBe('secondary');
  });

  it('T-WEB-9 a busy Button says so, shows a spinner and ignores presses; an idle one has no spinner', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('[data-spinner]')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<Button onClick={onClick}>Save</Button>);
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.querySelector('[data-spinner]')).toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('T-WEB-9 only the Button spins; the skeleton pulse is the only other motion, and both stop for reduced motion', () => {
    for (const file of filesUnder(UI, (f) => f.endsWith('.module.css'))) {
      const css = readFileSync(file, 'utf8');
      const base = path.basename(file);
      if (/rotate\(/.test(css)) expect(base).toBe('Button.module.css');
      if (/animation\s*:/.test(css)) {
        expect(['Button.module.css', 'Skeleton.module.css']).toContain(base);
        expect(css, base).toMatch(/prefers-reduced-motion:\s*reduce/);
      }
    }
  });

  it('T-WEB-9 a field error is tied to its input with aria-describedby and aria-invalid', () => {
    render(<Field label="Email" hint="We send a code here." error="That address doesn’t look right." />);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('We send a code here.');
    expect(described).toContain('That address doesn’t look right.');
  });

  it('T-WEB-9 without an error the input is not invalid and points only at its hint', () => {
    render(<Field label="Email" hint="We send a code here." />);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(1);
  });

  it('T-WEB-9 no part source writes a style attribute (the content policy blocks inline styles)', () => {
    for (const file of filesUnder(UI, (f) => /\.tsx$/.test(f) && !f.endsWith('.test.tsx'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\bstyle=\{/);
    }
  });

  it.each(everyPart)('T-WEB-9 %s renders on the server with no style attribute of its own', (_name, part) => {
    const html = renderToString(withIntl(part));
    // React Aria's hidden native select carries an inline style; Field.module.css hides it again without one.
    const stray = html.replace(/<div style="[^"]*"[^>]*data-testid="hidden-select-container"/g, '');
    expect(stray).not.toMatch(/\sstyle="/);
  });
});

describe('T-WEB-15: every part has its folder and its stories', () => {
  it.each(PARTS)('T-WEB-15 %s/%s has its component, CSS module, stories and test', (tier, part) => {
    for (const ext of ['.tsx', '.module.css', '.stories.tsx', '.test.tsx']) {
      expect(statSync(path.join(UI, tier, part, `${part}${ext}`)).isFile(), `${part}${ext}`).toBe(true);
    }
  });

  it.each(PARTS)('T-WEB-15 %s/%s has stories in English and Spanish, light and dark', (tier, part) => {
    const stories = readFileSync(path.join(UI, tier, part, `${part}.stories.tsx`), 'utf8');
    expect(stories).toMatch(/globals:\s*\{\s*locale:\s*'es'\s*\}/);
    expect(stories).toMatch(/globals:\s*\{\s*theme:\s*'dark'\s*\}/);
    expect(stories).toMatch(/globals:\s*\{\s*locale:\s*'es',\s*theme:\s*'dark'\s*\}/);
    expect(stories).toMatch(/title:\s*'(Primitives|Patterns)\//);
  });

  it('T-WEB-15 Storybook uses the Next.js framework, the a11y add-on as an error, and both global switches', () => {
    const main = readFileSync(path.join(WEB, '.storybook/main.ts'), 'utf8');
    expect(main).toContain("'@storybook/nextjs'");
    expect(main).toContain("'@storybook/addon-a11y'");
    const preview = readFileSync(path.join(WEB, '.storybook/preview.tsx'), 'utf8');
    expect(preview).toMatch(/a11y:\s*\{\s*test:\s*'error'/);
    expect(preview).toContain('tokens.css');
    expect(preview).toMatch(/locale/);
    expect(preview).toMatch(/data-theme|dataset\.theme/);
  });

  it('T-WEB-15 test-storybook builds Storybook, serves it with http-server, waits with wait-on and runs the test runner', () => {
    const pkg = JSON.parse(readFileSync(path.join(WEB, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const script = pkg.scripts['test-storybook'] ?? '';
    expect(script).toMatch(/storybook build/);
    expect(script).toMatch(/http-server/);
    expect(script).toMatch(/wait-on/);
    expect(script).toMatch(/test-storybook --url/);
  });

  it('T-WEB-15 every part key the parts read exists in both languages', () => {
    const flat = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? flat(v as object, `${p}${k}.`) : [`${p}${k}`]));
    const enKeys = new Set(flat(en));
    const esKeys = new Set(flat(es));
    for (const file of filesUnder(UI, (f) => /\.tsx$/.test(f) && !f.endsWith('.test.tsx'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\('([\w.]+)'/g)) {
        expect(enKeys.has(m[1]!), `${path.basename(file)}: ${m[1]} in en`).toBe(true);
        expect(esKeys.has(m[1]!), `${path.basename(file)}: ${m[1]} in es`).toBe(true);
      }
    }
  });
});
