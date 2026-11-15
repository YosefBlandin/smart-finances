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
  'PUT /recipients/{key}/label',
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

test('T-DOC-2 the threat model covers the data stack, the upload path, delete-all, recovery and the shared account', () => {
  const text = read('threat-model.md');
  const named = [
    /DynamoDB table/,
    /upload bucket/,
    /user pool/,
    /presigned POST/,
    /delete-all/,
    /ERASED/,
    /35-day/,
    /self sign-up/,
    /TOTP/,
    /\bD-10\b/,
    /\bRK-6\b/,
    /invoke rights/,
  ];
  for (const pattern of named) assert.match(text, pattern);
});

test('T-ENR-24 ADR 0010 is accepted, cites its decisions, is listed, and the label route and item are in ADR 0004', () => {
  const text = read('adr/0010-recipient-labels.md');
  assert.match(text, /^Status: accepted/m);
  for (const id of ['D-10', 'D-11', 'D-12', 'D-13', 'D-14', 'D-18', 'D-19', 'D-21']) assert.ok(cites(text, id), `0010 cites ${id}`);
  for (const term of ['SF_MERCHANT', 'SF_CATEGORY_CODE', 'SF_RECIPIENT', 'private_columns', 'LBL#']) assert.ok(text.includes(term), `0010 names ${term}`);
  const index = read('adr/README.md').split('\n');
  assert.match(index.find((line) => line.includes('0010') && line.startsWith('|')) ?? '', /\baccepted\b/, 'README lists 0010 as accepted');
  const patterns = read('adr/0004-access-patterns.md');
  assert.ok(patterns.includes('| PUT /recipients/{key}/label |'), '0004 has the label route row');
  assert.ok(patterns.includes('`LBL#<recipient_key>`'), '0004 has the label item row');
});

test('T-ENR-24 the threat model names the new assets and the owner-machine boundary', () => {
  const text = read('threat-model.md');
  for (const pattern of [/recipient key/i, /recipient label/i, /hashing key/i, /owner's machine/i, /payments service/i, /names of people and shops/i, /private_columns/]) {
    assert.match(text, pattern);
  }
});

test('T-DOC-11 ADR 0011 is accepted, cites its decisions, has a Model gate section, is listed, and the threat model is v5', () => {
  const text = read('adr/0011-in-browser-category-suggestions.md');
  assert.match(text, /^Status: accepted/m);
  for (const id of ['D-7', 'D-17', 'D-22', 'D-23']) assert.ok(cites(text, id), `0011 cites ${id}`);
  assert.match(text, /^## Model gate$/m, '0011 has a Model gate section');
  const index = read('adr/README.md').split('\n');
  assert.match(index.find((line) => line.includes('0011') && line.startsWith('|')) ?? '', /\baccepted\b/, 'README lists 0011 as accepted');
  const threats = read('threat-model.md');
  assert.match(threats, /^Status: v5\b/m, 'the threat model status line says v5');
  for (const pattern of [/history examples/i, /model file/i, /integrity/i, /suggest module/i]) assert.match(threats, pattern);
});

test('T-MOD-1 ADR 0011 records that no model was built (D-30), and the tree holds no model file, converter or loader', () => {
  const text = read('adr/0011-in-browser-category-suggestions.md');
  const gate = text.split(/^## Model gate$/m)[1]?.split(/^## /m)[0] ?? '';
  assert.ok(cites(gate, 'D-30'), 'the Model gate section cites D-30');
  assert.match(gate, /no model was built/i, 'the Model gate section says no model was built');
  assert.doesNotMatch(gate, /pending/i, 'the Model gate section is filled in');
  const root = new URL('../../../', import.meta.url);
  for (const path of [
    'apps/web/fixtures/suggest-eval.json',
    'apps/web/src/domain/suggest-model.ts',
    'apps/web/src/screens/review/suggest/model.ts',
    'apps/web/src/screens/review/suggest/suggest-model.bin',
    'scripts/suggest-model.mjs',
  ]) {
    assert.equal(fs.existsSync(new URL(path, root)), false, `${path} is not in the tree`);
  }
});
