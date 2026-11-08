// D-190, T-WEB-17: React Aria loads on first use. The parts every money page renders (the shell's menu, the month
// picker, the select field, the confirm dialog) import it only from the modules they load lazily, so no page's first
// load carries it and each page stays under the 200 KB script budget (D-134).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '..');
const LAZY = [
  'ui/patterns/MenuPanel/MenuPopover.tsx',
  'ui/patterns/MonthPicker/MonthGrid.tsx',
  'ui/primitives/Field/AriaSelectField.tsx',
  'ui/patterns/ConfirmDialog/ConfirmModal.tsx',
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

describe('T-WEB-17: React Aria loads on first use (D-190)', () => {
  it('T-WEB-17 only the lazily loaded modules import react-aria-components', () => {
    const importers = files(src)
      .filter((f) => /\.tsx?$/.test(f) && !/\.(test|stories)\.tsx?$/.test(f))
      .filter((f) => /from 'react-aria(-components)?'|from "react-aria(-components)?"/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(src, f))
      .sort();
    expect(importers).toEqual([...LAZY].sort());
  });

  it('T-WEB-17 each is imported only through import(), never statically', () => {
    for (const lazy of LAZY) {
      const name = lazy
        .split('/')
        .pop()!
        .replace(/\.tsx$/, '');
      const statics = files(src)
        .filter((f) => /\.tsx?$/.test(f) && !/\.(test|stories)\.tsx?$/.test(f))
        .filter((f) => new RegExp(`^import [^;]*from '\\./${name}'`, 'm').test(readFileSync(f, 'utf8')));
      expect(
        statics.map((f) => relative(src, f)),
        name,
      ).toEqual([]);
      const dynamic = files(src).filter((f) => readFileSync(f, 'utf8').includes(`import('./${name}')`));
      expect(dynamic.length, name).toBe(1);
    }
  });
});
