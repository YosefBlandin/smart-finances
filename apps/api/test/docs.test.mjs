import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const docs = new URL('../../../docs/', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, docs), 'utf8');
const cites = (text, id) => new RegExp(`\\b${id}\\b`).test(text);

const ADRS = {
  '0004-access-patterns.md': ['D-6', 'D-12', 'D-13', 'D-14', 'D-26', 'D-29'],
  '0006-imports-source-of-record.md': ['D-8', 'D-9', 'D-16', 'D-17', 'D-28'],
  '0007-shared-account.md': ['D-10'],
};

const ROUTES = [
  'GET /health',
  'POST /imports',
  'GET /imports',
  'GET /imports/{id}',
  'POST /imports/{id}/undo',
  'POST /periods/{source}/{period}/repair',
  'GET /transactions',
  'GET /totals',
  'GET /review',
  'PUT /transactions/{id}/review',
  'GET /rates',
  'PUT /rates/{month}',
  'POST /totals/rebuild',
  'GET /export',
  'DELETE /data',
];

test('T-DOC-1 ADRs 0004, 0006 and 0007 exist, cite their decisions and are listed as accepted', () => {
  for (const [file, ids] of Object.entries(ADRS)) {
    const text = read(`adr/${file}`);
    assert.match(text, /^Status: accepted/m, `${file} is accepted`);
    for (const id of ids) assert.ok(cites(text, id), `${file} cites ${id}`);
  }

  const patterns = read('adr/0004-access-patterns.md');
  for (const route of ROUTES) assert.ok(patterns.includes(`| ${route} |`), `0004 has an access-pattern row for ${route}`);

  const index = read('adr/README.md').split('\n');
  const row = (number) => index.find((line) => line.includes(`${number}`) && line.startsWith('|'));
  for (const number of ['0001', '0002', '0003', '0004', '0006', '0007']) {
    assert.match(row(number) ?? '', /\baccepted\b/, `README lists ${number} as accepted`);
  }
  assert.match(row('0005') ?? '', /\bplanned\b/, 'README keeps 0005 planned');
});
