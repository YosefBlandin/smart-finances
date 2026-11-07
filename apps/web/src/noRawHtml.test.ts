// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// T-WSCR-14 (SF-170, AC-9): scripts/check-no-raw-html.mjs is the check; this runs it so the id has a test title.
const SCRIPT = resolve(__dirname, '../../../scripts/check-no-raw-html.mjs');
const run = (folder?: string) => spawnSync(process.execPath, folder ? [SCRIPT, folder] : [SCRIPT], { encoding: 'utf8' });

describe('T-WSCR-14: no raw HTML insertion or markdown renderer in apps/web/src', () => {
  const planted = mkdtempSync(join(tmpdir(), 'no-raw-html-'));
  afterAll(() => rmSync(planted, { recursive: true, force: true }));

  it('T-WSCR-14: apps/web/src passes the check', () => {
    const result = run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('T-WSCR-14: the check fails on planted raw HTML and on a markdown renderer import', () => {
    // Built from parts so this file does not trip the check itself.
    writeFileSync(join(planted, 'raw.tsx'), `export const X = () => <div ${'dangerously' + 'SetInnerHTML'}={{ __html: '' }} />;\n`);
    expect(run(planted).status).not.toBe(0);
    rmSync(join(planted, 'raw.tsx'));
    writeFileSync(join(planted, 'md.ts'), `import Markdown from '${'react-' + 'markdown'}';\nexport default Markdown;\n`);
    expect(run(planted).status).not.toBe(0);
  });
});
