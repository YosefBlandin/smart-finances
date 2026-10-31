import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { afterEach, describe, expect, it } from 'vitest';

// T-WEB-13 (D-132, D-138, D-140): the lint rules hold the layers apart, and a11y and hooks mistakes fail the lint.
// Each case writes small fixture files that break (or respect) one rule, lints them with the real config, and removes them.
const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, 'eslint.config.mjs') });
const made: string[] = [];
const madeDirs: string[] = [];

function write(rel: string, text: string) {
  const file = path.join(root, rel);
  const missing: string[] = [];
  for (let d = path.dirname(file); !existsSync(d); d = path.dirname(d)) missing.push(d);
  mkdirSync(path.dirname(file), { recursive: true });
  madeDirs.push(...missing);
  writeFileSync(file, text);
  made.push(file);
}

async function rulesFor(files: Record<string, string>, target: string): Promise<string[]> {
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  const [result] = await eslint.lintFiles([target]);
  return (result?.messages ?? []).map((m) => `${m.ruleId}${m.severity === 2 ? '' : ' (warning)'}`);
}

afterEach(() => {
  for (const f of made.splice(0)) rmSync(f, { force: true });
  for (const d of madeDirs.splice(0).sort((a, b) => b.length - a.length)) rmSync(d, { recursive: true, force: true });
});

const RESTRICTED = 'import/no-restricted-paths';
const stub = (name: string) => ({ [`src/${name}.ts`]: 'export const value = 1;\n' });
const importing = (from: string, to: string, tsx = false) => ({
  [`src/${from}/zz_fixture${tsx ? '.tsx' : '.ts'}`]: `import { value } from '${to}';\nexport const out = value;\n`,
});

describe('T-WEB-13 the dependency direction (D-138)', () => {
  it('T-WEB-13 fails a domain file that imports an adapter', async () => {
    const rules = await rulesFor({ ...stub('adapters/zz_thing'), ...importing('domain', '../adapters/zz_thing') }, 'src/domain/zz_fixture.ts');
    expect(rules).toContain(RESTRICTED);
  });

  it.each([
    ['domain', 'application'],
    ['domain', 'ports'],
    ['domain', 'ui/primitives'],
    ['application', 'adapters'],
    ['application', 'app'],
    ['application', 'ui/patterns'],
    ['ui/primitives', 'adapters'],
    ['ui/patterns', 'application'],
    ['screens/overview', 'adapters'],
    ['screens/overview', 'application'],
    ['queries', 'adapters'],
    ['queries', 'application'],
    ['ui/primitives', 'queries'],
  ])('T-WEB-13 fails %s importing %s', async (from, to) => {
    const dep = `src/${to}/zz_dep.ts`;
    const spec = path.posix.relative(`src/${from}`, `src/${to}/zz_dep`);
    const rules = await rulesFor(
      { [dep]: 'export const value = 1;\n', ...importing(from, spec.startsWith('.') ? spec : `./${spec}`) },
      `src/${from}/zz_fixture.ts`,
    );
    expect(rules).toContain(RESTRICTED);
  });

  it.each([
    ['application', 'domain'],
    ['application', 'ports'],
    ['adapters', 'application'],
    ['app', 'screens/overview'],
    ['screens/overview', 'ui/patterns'],
    ['screens/overview', 'queries'],
    ['ui/patterns', 'ui/primitives'],
    ['ui/primitives', 'styles'],
  ])('T-WEB-13 allows %s importing %s', async (from, to) => {
    const spec = path.posix.relative(`src/${from}`, `src/${to}/zz_dep`);
    const rules = await rulesFor(
      {
        [`src/${to}/zz_dep.ts`]: 'export const value = 1;\n',
        ...importing(from, spec.startsWith('.') ? spec : `./${spec}`),
      },
      `src/${from}/zz_fixture.ts`,
    );
    expect(rules).not.toContain(RESTRICTED);
  });

  it('T-WEB-13 keeps frameworks out of the domain and the use cases', async () => {
    const domain = await rulesFor(
      { 'src/domain/zz_fixture.ts': "import { cookies } from 'next/headers';\nexport const c = cookies;\n" },
      'src/domain/zz_fixture.ts',
    );
    expect(domain).toContain('no-restricted-imports');
    const app = await rulesFor(
      {
        'src/application/zz_fixture.ts': "import { DynamoDBClient } from '@aws-sdk/client-dynamodb';\nexport const c = DynamoDBClient;\n",
      },
      'src/application/zz_fixture.ts',
    );
    expect(app).toContain('no-restricted-imports');
  });
});

describe('T-WEB-13 accessibility and hooks rules', () => {
  it('T-WEB-13 fails an image with no alt text', async () => {
    const rules = await rulesFor({ 'src/ui/zz_fixture.tsx': 'export const A = () => <img src="/x.png" />;\n' }, 'src/ui/zz_fixture.tsx');
    expect(rules).toContain('jsx-a11y/alt-text');
  });

  it('T-WEB-13 fails a clickable div with no role or keyboard handling', async () => {
    const rules = await rulesFor({ 'src/ui/zz_fixture.tsx': 'export const A = () => <div onClick={() => {}}>go</div>;\n' }, 'src/ui/zz_fixture.tsx');
    expect(rules.some((r) => r.startsWith('jsx-a11y/'))).toBe(true);
  });

  it('T-WEB-13 fails a hook called conditionally', async () => {
    const src = "import { useState } from 'react';\nexport function A({ on }: { on: boolean }) {\n  if (on) useState(0);\n  return null;\n}\n";
    const rules = await rulesFor({ 'src/ui/zz_fixture.tsx': src }, 'src/ui/zz_fixture.tsx');
    expect(rules).toContain('react-hooks/rules-of-hooks');
  });

  it('T-WEB-13 accepts a labelled image', async () => {
    const rules = await rulesFor(
      { 'src/ui/zz_fixture.tsx': 'export const A = () => <img src="/x.png" alt="A chart" />;\n' },
      'src/ui/zz_fixture.tsx',
    );
    expect(rules.filter((r) => !r.endsWith('(warning)'))).toEqual([]);
  });
});

describe('T-WEB-13 Prettier', () => {
  it('T-WEB-13 flags code that is not formatted', async () => {
    const options = (await prettier.resolveConfig(path.join(root, 'src/x.ts'))) ?? {};
    expect(await prettier.check('const a   =  {b:1}\n', { ...options, filepath: 'x.ts' })).toBe(false);
  });

  it('T-WEB-13 passes on the app sources', () => {
    const bin = path.join(root, '../../node_modules/prettier/bin/prettier.cjs');
    expect(() =>
      execFileSync(
        process.execPath,
        [bin, '--check', '--no-error-on-unmatched-pattern', '{src,e2e,scripts,.storybook}/**/*.{ts,tsx,mjs,css}', '*.{ts,mjs,json}'],
        {
          cwd: root,
          stdio: 'pipe',
        },
      ),
    ).not.toThrow();
  });
});
