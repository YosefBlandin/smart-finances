#!/usr/bin/env node
// T-WSCR-14 (SF-170, AC-9): imported text and assistant answers render only as React text nodes. This check fails when
// apps/web/src (or the folder given as the first argument) holds raw HTML insertion (dangerouslySetInnerHTML,
// innerHTML, outerHTML, insertAdjacentHTML, document.write, createContextualFragment, DOMParser) or imports a markdown
// renderer. Root `npm test` runs it. Usage: node scripts/check-no-raw-html.mjs [folder]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? join(root, 'apps/web/src'));

const RAW_HTML = [
  { name: 'dangerouslySetInnerHTML', pattern: /\bdangerouslySetInnerHTML\b/ },
  { name: 'innerHTML', pattern: /\binnerHTML\b/ },
  { name: 'outerHTML', pattern: /\bouterHTML\b/ },
  { name: 'insertAdjacentHTML', pattern: /\binsertAdjacentHTML\b/ },
  { name: 'document.write', pattern: /\bdocument\s*\.\s*write(?:ln)?\s*\(/ },
  { name: 'createContextualFragment', pattern: /\bcreateContextualFragment\b/ },
  { name: 'DOMParser', pattern: /\bDOMParser\b/ },
];

// Markdown renderers and HTML-from-string helpers, by the package a file imports or requires.
const MARKDOWN = [
  'react-markdown',
  'marked',
  'markdown-it',
  'remark',
  'remark-html',
  'remark-rehype',
  'rehype-raw',
  'rehype-stringify',
  'micromark',
  'mdast-util-to-hast',
  'showdown',
  'snarkdown',
  'commonmark',
  'markdown-to-jsx',
  'html-react-parser',
  '@mdx-js/mdx',
  '@mdx-js/react',
];
const importOf = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
const packageName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (SOURCE.test(entry)) yield path;
  }
}

const found = [];
for (const file of files(target)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { name, pattern } of RAW_HTML) if (pattern.test(line)) found.push(`${relative(root, file)}:${i + 1}: ${name}`);
    for (const match of line.matchAll(importOf)) {
      const pkg = packageName(match[1]);
      if (MARKDOWN.includes(pkg)) found.push(`${relative(root, file)}:${i + 1}: markdown renderer ${pkg}`);
    }
  });
}

if (found.length > 0) {
  console.error(`check-no-raw-html: ${found.length} raw HTML insertion(s) or markdown renderer(s) in ${relative(root, target) || '.'} (AC-9):`);
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`check-no-raw-html: no raw HTML insertion or markdown renderer in ${relative(root, target) || '.'}`);
