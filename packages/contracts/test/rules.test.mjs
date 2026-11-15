// T-RULE-1 (category-suggestions D-15, AC-1): the payments import rules live here, browser-safe, and answer exactly as
// the API module did before the move. Public shops and apps only, plus made-up names; nothing from real data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CATEGORIES } from '../src/categories.mjs';
import { CODE_CATEGORIES, NAME_RULES, merchantCategory } from '../src/rules.mjs';

test('T-RULE-1 a known category code wins over any name rule', () => {
  assert.equal(merchantCategory({ code: '5411', merchant: '' }), 'Groceries');
  assert.equal(merchantCategory({ code: '5812', merchant: 'Netflix' }), 'Dining out');
  assert.equal(merchantCategory({ code: '4121' }), 'Transport');
  assert.equal(merchantCategory({ code: '5912', merchant: undefined }), 'Health & fitness');
  assert.equal(merchantCategory({ code: ' 0742 ' }), 'Pets', 'the code is trimmed');
});

test('T-RULE-1 a code miss falls to the merchant name rule', () => {
  assert.equal(merchantCategory({ code: '0000', merchant: 'NETFLIX.COM' }), 'Subscriptions & software');
  assert.equal(merchantCategory({ code: '', merchant: 'Uber Trip' }), 'Transport');
  assert.equal(merchantCategory({ merchant: 'MERPAGO*SPOTIFY' }), 'Subscriptions & software');
  assert.equal(merchantCategory({ code: '9999', merchant: 'Supermercado Coto 112' }), 'Groceries');
  assert.equal(merchantCategory({ merchant: 'PedidosYa' }), 'Dining out');
});

test('T-RULE-1 neither a code nor a name rule gives null, and names match whole words only', () => {
  assert.equal(merchantCategory({ code: '0000', merchant: 'Made-up Store 42' }), null);
  assert.equal(merchantCategory({ code: '', merchant: '' }), null);
  assert.equal(merchantCategory({}), null);
  assert.equal(merchantCategory(), null);
  assert.equal(merchantCategory({ code: '54111', merchant: 'zzz' }), null, 'only exactly four digits is a code');
  assert.equal(merchantCategory({ merchant: 'Diamante Libreria' }), null);
  assert.equal(merchantCategory({ merchant: 'Cuberto Lopez' }), null);
});

test('T-RULE-1 every mapped category is in the shared list, never Uncategorized', () => {
  assert.ok(Object.keys(CODE_CATEGORIES).length > 0 && NAME_RULES.length > 0);
  for (const [code, category] of Object.entries(CODE_CATEGORIES)) {
    assert.match(code, /^\d{4}$/);
    assert.ok(CATEGORIES.includes(category) && category !== 'Uncategorized', `${code} -> ${category}`);
  }
  for (const [re, category] of NAME_RULES) {
    assert.ok(re instanceof RegExp);
    assert.ok(CATEGORIES.includes(category) && category !== 'Uncategorized', `${re} -> ${category}`);
  }
});

test('T-RULE-1 the rules are exported as ./rules and import only ./categories.mjs (browser-safe)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['./rules'], './src/rules.mjs');
  const source = readFileSync(new URL('../src/rules.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./categories.mjs']);
});
