// T-ENR-3 (AC-3, D-15): Mercado Pago category codes and merchant names to categories. Names are public shops and
// apps only; nothing here comes from real data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '@smart-finances/contracts/categories';
import * as shared from '@smart-finances/contracts/rules';
import { CODE_CATEGORIES, NAME_RULES, merchantCategory } from '../src/ingest/merchants.mjs';

test('T-ENR-3 a known category code maps to its category, before any name rule', () => {
  assert.equal(merchantCategory({ code: '5411', merchant: '' }), 'Groceries');
  assert.equal(merchantCategory({ code: '5812', merchant: 'Netflix' }), 'Dining out', 'the code wins over the name');
  assert.equal(merchantCategory({ code: '4121' }), 'Transport');
  assert.equal(merchantCategory({ code: '5912', merchant: undefined }), 'Health & fitness');
});

test('T-ENR-3 a code miss falls to the merchant name rule', () => {
  assert.equal(merchantCategory({ code: '0000', merchant: 'NETFLIX.COM' }), 'Subscriptions & software');
  assert.equal(merchantCategory({ code: '', merchant: 'Uber Trip' }), 'Transport');
  assert.equal(merchantCategory({ merchant: 'MERPAGO*SPOTIFY' }), 'Subscriptions & software');
  assert.equal(merchantCategory({ code: '9999', merchant: 'Supermercado Coto 112' }), 'Groceries');
  assert.equal(merchantCategory({ merchant: 'PedidosYa' }), 'Dining out');
});

test('T-ENR-3 neither a code nor a name rule gives null', () => {
  assert.equal(merchantCategory({ code: '0000', merchant: 'Made-up Store 42' }), null);
  assert.equal(merchantCategory({ code: '', merchant: '' }), null);
  assert.equal(merchantCategory({}), null);
  assert.equal(merchantCategory({ code: '54111', merchant: 'zzz' }), null, 'only exactly four digits is a code');
});

test('T-ENR-3 a name rule matches whole words only, so a short brand never hides inside another word', () => {
  assert.equal(merchantCategory({ merchant: 'Diamante Libreria' }), null);
  assert.equal(merchantCategory({ merchant: 'Cuberto Lopez' }), null);
});

test('T-ENR-3 every mapped category is in the shared list, never Uncategorized', () => {
  for (const [code, category] of Object.entries(CODE_CATEGORIES)) {
    assert.match(code, /^\d{4}$/);
    assert.ok(CATEGORIES.includes(category) && category !== 'Uncategorized', `${code} -> ${category}`);
  }
  for (const [re, category] of NAME_RULES) {
    assert.ok(re instanceof RegExp);
    assert.ok(CATEGORIES.includes(category) && category !== 'Uncategorized', `${re} -> ${category}`);
  }
});

// T-RULE-2 (category-suggestions D-15, RK-6): the API module re-exports the contracts copy, so the importer and the
// browser use one set of rules.
test('T-RULE-2 the API module exports the same objects as @smart-finances/contracts/rules', () => {
  assert.equal(merchantCategory, shared.merchantCategory);
  assert.equal(CODE_CATEGORIES, shared.CODE_CATEGORIES);
  assert.equal(NAME_RULES, shared.NAME_RULES);
});
