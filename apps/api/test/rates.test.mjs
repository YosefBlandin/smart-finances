// Rates and GET /totals (D-7, D-27, D-39) against the in-memory store. Figures are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '@smart-finances/contracts/routes';
import { createMemoryStore } from '../src/store/memory.mjs';
import { erasedKey, rateKey, sumKey } from '../src/store/keys.mjs';
import { arsToUsd, divideRounded } from '../src/store/rates.mjs';
import { createReadHandler } from '../src/handlers/read.mjs';
import { createWriteHandler } from '../src/handlers/write.mjs';
import { httpEvent } from './fixtures/http.mjs';

const A = 'person-a';
const B = 'person-b';
const T0 = Date.parse('2026-11-01T12:00:00.000Z');

function world() {
  const store = createMemoryStore();
  const read = createReadHandler({ store, now: () => T0 });
  const write = createWriteHandler({ store, now: () => T0 });
  const call = async (handler, sub, routeKey, opts) => {
    const res = await handler(httpEvent(sub, routeKey, opts));
    const body = JSON.parse(res.body);
    if (res.statusCode < 300) assert.ok(ROUTES[routeKey].reply.safeParse(body).success, `${routeKey} reply parses`);
    return { status: res.statusCode, body };
  };
  const sum = (sub, month, totals, row_count = 1) => store.put({ ...sumKey(sub, month), month, totals, row_count, computed_at: T0 });
  return {
    store,
    sum,
    totals: (sub, query) => call(read, sub, 'GET /totals', { queryStringParameters: query }),
    rates: (sub) => call(read, sub, 'GET /rates'),
    putRate: (sub, month, body) => call(write, sub, 'PUT /rates/{month}', { pathParameters: { month }, body }),
  };
}

test('T-API-6 GET /totals returns stored totals for the range, skips tombstones, and the native view keeps every currency', async () => {
  const w = world();
  const may = { expense: { Groceries: { ARS: -150000, USD: -1250 } }, income: { Salary: { USD: 300000 } }, transfer_out: { Transfers: { ARS: -5000 } } };
  await w.sum(A, '2026-04', { expense: { Groceries: { ARS: -1 } } });
  await w.sum(A, '2026-05', may);
  await w.sum(A, '2026-06', {}, 0); // tombstone
  await w.sum(A, '2026-07', { expense: { Rent: { USD: -50000 } } });
  await w.sum(A, '2026-08', { expense: { Groceries: { ARS: -1 } } });
  await w.sum(B, '2026-05', { expense: { Groceries: { ARS: -9 } } });

  const res = await w.totals(A, { from: '2026-05', to: '2026-07' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.months, [
    { month: '2026-05', totals: may },
    { month: '2026-07', totals: { expense: { Rent: { USD: -50000 } } } },
  ]);
  assert.deepEqual(res.body.missing_rates, ['2026-05'], 'May has pesos and no rate; July has none');
  assert.deepEqual((await w.totals(B, { from: '2026-07', to: '2026-07' })).body, { months: [], missing_rates: [] });
  for (const query of [{ from: '2026-07', to: '2026-05' }, { from: '2026-05' }, { from: '2026-05', to: '2026-07', view: 'eur' }]) {
    const bad = await w.totals(A, query);
    assert.deepEqual([bad.status, bad.body.error.code], [400, 'bad_request'], JSON.stringify(query));
  }
  assert.equal((await w.totals(null, { from: '2026-05', to: '2026-07' })).status, 401);
});

test('T-API-6 GET /totals answers conflict while erasing and in the quiet window', async () => {
  const w = world();
  await w.sum(A, '2026-05', { expense: { Groceries: { USD: -1 } } });
  await w.store.put({ ...erasedKey(A), erased_at: new Date(T0 - 1000).toISOString() });
  const erasing = await w.totals(A, { from: '2026-05', to: '2026-05' });
  assert.deepEqual([erasing.status, erasing.body.error.code], [409, 'conflict']);
  await w.store.put({ ...erasedKey(A), erased_at: new Date(T0 - 1000).toISOString(), quiet_until: new Date(T0).toISOString() });
  assert.equal((await w.totals(A, { from: '2026-05', to: '2026-05' })).status, 409);
  await w.store.put({ ...erasedKey(A), erased_at: new Date(T0 - 1000).toISOString(), quiet_until: new Date(T0 - 1).toISOString() });
  assert.equal((await w.totals(A, { from: '2026-05', to: '2026-05' })).status, 200);
});

test('T-API-7 rounding is half away from zero in integer cents', () => {
  assert.equal(divideRounded(5, 2), 3);
  assert.equal(divideRounded(-5, 2), -3);
  assert.equal(divideRounded(7, 3), 2);
  assert.equal(divideRounded(-7, 3), -2);
  assert.equal(divideRounded(8, 3), 3);
  assert.equal(divideRounded(0, 7), 0);
  // ARS 1,234.56 at 1,000.00 per dollar: 123456 x 100 / 100000 = 123.456 -> 123 cents.
  assert.equal(arsToUsd(123456, 100000), 123);
  // ARS 1,250.00 at 1,000.00: exactly 125 cents; ARS -12.50 at 10.00: -125 cents.
  assert.equal(arsToUsd(125000, 100000), 125);
  assert.equal(arsToUsd(-1250, 1000), -125);
  // ARS 0.05 at 10.00 = 0.5 cents -> 1 cent; -0.05 -> -1 cent.
  assert.equal(arsToUsd(5, 1000), 1);
  assert.equal(arsToUsd(-5, 1000), -1);
});

test('T-API-7 the usd view converts pesos at the month rate, passes dollars through and names months without a rate', async () => {
  const w = world();
  await w.sum(A, '2026-05', { expense: { Groceries: { ARS: -123456, USD: -1000 }, Fees: { ARS: -500 } }, income: { Salary: { USD: 300000 } } });
  await w.sum(A, '2026-06', { expense: { Groceries: { ARS: -100000, USD: -200 } } });
  assert.equal((await w.putRate(A, '2026-05', { ars_per_usd: 1000 })).status, 200);
  const res = await w.totals(A, { from: '2026-05', to: '2026-06', view: 'usd' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.months, [
    { month: '2026-05', totals: { expense: { Groceries: { USD: -1123 }, Fees: { USD: -1 } }, income: { Salary: { USD: 300000 } } } },
    { month: '2026-06', totals: { expense: { Groceries: { USD: -200 } } } },
  ]);
  assert.deepEqual(res.body.missing_rates, ['2026-06'], 'June pesos stay out of the dollar figure');
});

test('T-API-7 rates: numbers with at most two decimals on the wire, two-decimal strings in the table; a bad rate gives bad_request', async () => {
  const w = world();
  const put = await w.putRate(A, '2026-05', { ars_per_usd: 1234.5 });
  assert.deepEqual(put, { status: 200, body: { month: '2026-05', ars_per_usd: 1234.5 } });
  assert.equal((await w.store.get(rateKey(A, '2026-05'))).ars_per_usd, '1234.50');
  assert.equal((await w.store.get(rateKey(A, '2026-05'))).updated_at, new Date(T0).toISOString());
  await w.putRate(A, '2026-03', { ars_per_usd: 980.25 });
  assert.deepEqual((await w.rates(A)).body, { items: [{ month: '2026-03', ars_per_usd: 980.25 }, { month: '2026-05', ars_per_usd: 1234.5 }] });
  assert.deepEqual((await w.rates(B)).body, { items: [] });

  for (const [month, body] of [
    ['2026-05', { ars_per_usd: 0 }],
    ['2026-05', { ars_per_usd: -1 }],
    ['2026-05', { ars_per_usd: 1.234 }],
    ['2026-05', { ars_per_usd: '1000' }],
    ['2026-05', {}],
    ['2026-05', 'not json'],
    ['2026-13', { ars_per_usd: 1000 }],
    ['2026-5', { ars_per_usd: 1000 }],
  ]) {
    const res = await w.putRate(A, month, body);
    assert.deepEqual([res.status, res.body.error?.code], [400, 'bad_request'], `${month} ${JSON.stringify(body)}`);
  }
  assert.equal((await w.store.get(rateKey(A, '2026-05'))).ars_per_usd, '1234.50', 'unchanged');

  // In the erase window a rate is refused, so nothing outlives the erase.
  await w.store.put({ ...erasedKey(A), erased_at: new Date(T0).toISOString() });
  const refused = await w.putRate(A, '2026-07', { ars_per_usd: 1000 });
  assert.deepEqual([refused.status, refused.body.error.code], [409, 'conflict']);
  assert.equal(await w.store.get(rateKey(A, '2026-07')), undefined);
});
