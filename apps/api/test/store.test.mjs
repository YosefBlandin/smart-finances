import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as keys from '../src/store/keys.mjs';
import { ConditionFailed, createMemoryStore } from '../src/store/memory.mjs';
import { ConditionFailed as RepoConditionFailed, createRepo } from '../src/store/repo.mjs';
import { S3Client } from '@aws-sdk/client-s3';

const { erasedKey, impKey, monthRange, ovrKey, perKey, personPk, PREFIX, rateKey, sumKey, txnKey, uploadKey } = keys;

// One builder per item kind in ADR 0004 "Table items". A new kind must be added here on purpose.
const BUILDERS = {
  txnKey: (sub) => txnKey(sub, '2026-03-15', '0123456789abcdef'),
  ovrKey: (sub) => ovrKey(sub, '2026-03-15', '0123456789abcdef'),
  impKey: (sub) => impKey(sub, '01JAAAAAAAAAAAAAAAAAAAAAAA'),
  perKey: (sub) => perKey(sub, 'mercadopago', '2026-03'),
  rateKey: (sub) => rateKey(sub, '2026-03'),
  sumKey: (sub) => sumKey(sub, '2026-03'),
  erasedKey: (sub) => erasedKey(sub),
};

test('T-KEY-1 every key kind is built from the person and its parts, and never collides across people', () => {
  assert.equal(Object.keys(BUILDERS).length, 7);
  assert.deepEqual(
    Object.keys(keys).filter((name) => name.endsWith('Key') && name !== 'uploadKey').sort(),
    Object.keys(BUILDERS).sort(),
    'the module exports exactly the 7 item key builders',
  );
  assert.deepEqual(Object.keys(keys).sort(), [...Object.keys(BUILDERS), 'PREFIX', 'monthRange', 'personPk', 'uploadKey'].sort());

  assert.equal(personPk('sub-a'), 'U#sub-a');
  assert.deepEqual(BUILDERS.txnKey('sub-a'), { pk: 'U#sub-a', sk: 'TXN#2026-03-15#0123456789abcdef' });
  assert.deepEqual(BUILDERS.ovrKey('sub-a'), { pk: 'U#sub-a', sk: 'OVR#2026-03-15#0123456789abcdef' });
  assert.deepEqual(BUILDERS.impKey('sub-a'), { pk: 'U#sub-a', sk: 'IMP#01JAAAAAAAAAAAAAAAAAAAAAAA' });
  assert.deepEqual(BUILDERS.perKey('sub-a'), { pk: 'U#sub-a', sk: 'PER#mercadopago#2026-03' });
  assert.deepEqual(perKey('sub-a', 'notion', 'log'), { pk: 'U#sub-a', sk: 'PER#notion#log' });
  assert.deepEqual(BUILDERS.rateKey('sub-a'), { pk: 'U#sub-a', sk: 'RATE#2026-03' });
  assert.deepEqual(BUILDERS.sumKey('sub-a'), { pk: 'U#sub-a', sk: 'SUM#2026-03' });
  assert.deepEqual(BUILDERS.erasedKey('sub-a'), { pk: 'U#sub-a', sk: 'ERASED' });
  assert.equal(uploadKey('sub-a', '01JAAAAAAAAAAAAAAAAAAAAAAA'), 'uploads/sub-a/01JAAAAAAAAAAAAAAAAAAAAAAA');

  for (const [name, build] of Object.entries(BUILDERS)) {
    assert.notEqual(build('sub-a').pk, build('sub-b').pk, `${name} gives each person their own pk`);
    assert.equal(build('sub-a').pk, personPk('sub-a'));
  }
  assert.notEqual(uploadKey('sub-a', 'x'), uploadKey('sub-b', 'x'));

  // A part that could reach into another key or object path is refused.
  for (const bad of ['a#b', 'a/b', '', '#', '/']) {
    assert.throws(() => personPk(bad), /key part/);
    assert.throws(() => txnKey('sub-a', '2026-03-15', bad), /key part/);
    assert.throws(() => ovrKey('sub-a', '2026-03-15', bad), /key part/);
    assert.throws(() => impKey('sub-a', bad), /key part/);
    assert.throws(() => perKey('sub-a', bad, '2026-03'), /key part/);
    assert.throws(() => uploadKey(bad, 'x'), /key part/);
    assert.throws(() => uploadKey('sub-a', bad), /key part/);
  }
  assert.throws(() => personPk(undefined), /key part/);
  assert.throws(() => txnKey('sub-a', '2026-03', 'x'), /date/);
  assert.throws(() => ovrKey('sub-a', '2026-3-15', 'x'), /date/);
  assert.throws(() => perKey('sub-a', 'notion', '2026'), /period/);
  assert.throws(() => rateKey('sub-a', '2026-03-01'), /month/);
  assert.throws(() => sumKey('sub-a', 'log'), /month/);

  // Month ranges include the whole last month.
  assert.deepEqual(monthRange(PREFIX.TXN, '2026-01', '2026-03'), ['TXN#2026-01', 'TXN#2026-03~']);
  const [lo, hi] = monthRange(PREFIX.TXN, '2026-01', '2026-03');
  const inRange = (sk) => sk >= lo && sk <= hi;
  assert.ok(inRange(txnKey('s', '2026-01-01', 'ffffffffffffffff').sk));
  assert.ok(inRange(txnKey('s', '2026-03-31', 'ffffffffffffffff').sk));
  assert.ok(!inRange(txnKey('s', '2025-12-31', 'ffffffffffffffff').sk));
  assert.ok(!inRange(txnKey('s', '2026-04-01', '0000000000000000').sk));
  assert.ok(!inRange(ovrKey('s', '2026-02-01', '0000000000000000').sk));
  assert.throws(() => monthRange(PREFIX.TXN, '2026-03', '2026-01'), /range/);
  assert.throws(() => monthRange('NOPE#', '2026-01', '2026-03'), /prefix/);
});

const item = (sub, date, id, extra = {}) => ({ ...txnKey(sub, date, id), amount: -100, ...extra });

test('T-KEY-2 the memory store honours conditions, all-or-nothing transactions and sort-key queries', async () => {
  const store = createMemoryStore();
  const a = txnKey('sub-a', '2026-03-15', 'aaaaaaaaaaaaaaaa');

  // Conditions on put and remove.
  await store.put(item('sub-a', '2026-03-15', 'aaaaaaaaaaaaaaaa'), { if: [{ attr: 'pk', exists: false }] });
  await assert.rejects(
    store.put(item('sub-a', '2026-03-15', 'aaaaaaaaaaaaaaaa'), { if: [{ attr: 'pk', exists: false }] }),
    (err) => err instanceof ConditionFailed && err.index === undefined,
  );
  await store.put({ ...a, amount: -200, computed_at: 5 }, { if: [{ attr: 'amount', op: '=', value: -100 }] });
  assert.equal((await store.get(a, { consistent: true })).amount, -200);
  await assert.rejects(store.put({ ...a, computed_at: 9 }, { if: [{ attr: 'computed_at', op: '>', value: 5 }] }), ConditionFailed);
  // A missing attribute fails a comparison, as in DynamoDB.
  await assert.rejects(store.put({ ...a }, { if: [{ attr: 'missing', op: '<', value: 5 }] }), ConditionFailed);
  // any: absent or older wins.
  const absentOrOlder = (t) => [{ any: [{ attr: 'pk', exists: false }, { attr: 'computed_at', op: '<', value: t }] }];
  await store.put({ ...a, computed_at: 7 }, { if: absentOrOlder(7 + 1) });
  await assert.rejects(store.put({ ...a, computed_at: 6 }, { if: absentOrOlder(6) }), ConditionFailed);
  await store.put({ ...sumKey('sub-a', '2026-03'), computed_at: 1 }, { if: absentOrOlder(1) });
  for (const op of ['=', '<', '>', '<=', '>=']) {
    await store.put({ ...a, computed_at: 7 }, { if: [{ attr: 'computed_at', op, value: { '=': 7, '<': 8, '>': 6, '<=': 7, '>=': 7 }[op] }] });
  }
  await assert.rejects(store.remove(a, { if: [{ attr: 'computed_at', op: '=', value: 1 }] }), ConditionFailed);
  await store.remove(a, { if: [{ attr: 'computed_at', op: '=', value: 7 }] });
  assert.equal(await store.get(a), undefined);

  // Stored items are copies: changing what was put or got does not change the store.
  const original = item('sub-a', '2026-03-15', 'bbbbbbbbbbbbbbbb', { flags: ['x'] });
  await store.put(original);
  original.flags.push('y');
  const got = await store.get(txnKey('sub-a', '2026-03-15', 'bbbbbbbbbbbbbbbb'));
  assert.deepEqual(got.flags, ['x']);
  got.amount = 1;
  assert.equal((await store.get(txnKey('sub-a', '2026-03-15', 'bbbbbbbbbbbbbbbb'))).amount, -100);

  // All or nothing: a failed check means none of the writes land, and the error names the item.
  const imp = impKey('sub-a', '01JAAAAAAAAAAAAAAAAAAAAAAA');
  await assert.rejects(
    store.transact([
      { put: { ...imp, status: 'importing' } },
      { remove: txnKey('sub-a', '2026-03-15', 'bbbbbbbbbbbbbbbb') },
      { check: erasedKey('sub-a'), if: [{ attr: 'pk', exists: true }] },
    ]),
    (err) => err instanceof ConditionFailed && err.index === 2,
  );
  assert.equal(await store.get(imp), undefined);
  assert.ok(await store.get(txnKey('sub-a', '2026-03-15', 'bbbbbbbbbbbbbbbb')));
  await store.transact([
    { check: erasedKey('sub-a'), if: [{ attr: 'pk', exists: false }] },
    { put: { ...imp, status: 'importing' }, if: [{ attr: 'pk', exists: false }] },
    { remove: txnKey('sub-a', '2026-03-15', 'bbbbbbbbbbbbbbbb') },
  ]);
  assert.equal((await store.get(imp)).status, 'importing');
  assert.equal(await store.get(txnKey('sub-a', '2026-03-15', 'bbbbbbbbbbbbbbbb')), undefined);
  await assert.rejects(store.transact([{ put: { ...imp } }, { remove: imp }]), /twice/);

  // Range and prefix queries stay inside one partition and sort by sk.
  // Put out of order, so only the store's own sort can return them in sk order.
  for (const [sub, date, id] of [
    ['sub-a', '2026-04-01', '4444444444444444'],
    ['sub-b', '2026-02-10', '5555555555555555'],
    ['sub-a', '2026-01-31', '1111111111111111'],
    ['sub-a', '2026-03-31', '3333333333333333'],
    ['sub-a', '2026-02-10', '2222222222222222'],
  ]) await store.put(item(sub, date, id));
  await store.put({ ...ovrKey('sub-a', '2026-02-10', '2222222222222222'), approved: true });

  const pk = personPk('sub-a');
  const ranged = await store.query({ pk, between: monthRange(PREFIX.TXN, '2026-02', '2026-03'), consistent: true });
  assert.deepEqual(ranged.items.map((x) => x.sk), ['TXN#2026-02-10#2222222222222222', 'TXN#2026-03-31#3333333333333333']);
  assert.equal(ranged.cursor, undefined);

  const all = await store.query({ pk, prefix: PREFIX.TXN });
  assert.deepEqual(all.items.map((x) => x.sk), [
    'TXN#2026-01-31#1111111111111111',
    'TXN#2026-02-10#2222222222222222',
    'TXN#2026-03-31#3333333333333333',
    'TXN#2026-04-01#4444444444444444',
  ]);
  assert.ok(all.items.every((x) => x.pk === pk));
  assert.deepEqual((await store.query({ pk, prefix: PREFIX.OVR })).items.length, 1);
  assert.deepEqual((await store.query({ pk: personPk('sub-b'), prefix: PREFIX.TXN })).items.length, 1);
  assert.deepEqual((await store.query({ pk: personPk('sub-c'), prefix: PREFIX.TXN })).items, []);

  // Paging with limit and cursor visits every item once.
  const seen = [];
  let cursor;
  do {
    const page = await store.query({ pk, prefix: PREFIX.TXN, limit: 3, cursor });
    assert.ok(page.items.length <= 3);
    seen.push(...page.items.map((x) => x.sk));
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(seen, all.items.map((x) => x.sk));

  // Like DynamoDB, a full last page still carries a cursor, which then leads to an empty page.
  const pages = [];
  cursor = undefined;
  do {
    const page = await store.query({ pk, prefix: PREFIX.TXN, limit: 2, cursor });
    pages.push(page.items.map((x) => x.sk));
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(pages, [all.items.slice(0, 2).map((x) => x.sk), all.items.slice(2).map((x) => x.sk), []]);

  // With neither prefix nor between, the whole partition and nobody else's.
  const partition = await store.query({ pk });
  assert.deepEqual(partition.items.map((x) => x.sk), [
    ...all.items.map((x) => x.sk),
    'IMP#01JAAAAAAAAAAAAAAAAAAAAAAA',
    'OVR#2026-02-10#2222222222222222',
    'SUM#2026-03',
  ].sort());

  // Requests DynamoDB refuses are refused here too.
  await assert.rejects(store.query({ pk, prefix: '' }), /non-empty/);
  await assert.rejects(store.query({ pk, between: ['TXN#2026-03', 'TXN#2026-01'] }), /low first/);
  await assert.rejects(store.query({ pk: '', prefix: PREFIX.TXN }), /pk/);
  await assert.rejects(store.transact([]), /1 to 100/);
  const tooMany = Array.from({ length: 101 }, (_, i) => ({ put: { ...txnKey('sub-a', '2026-05-01', `${i}`.padStart(16, '0')) } }));
  await assert.rejects(store.transact(tooMany), /1 to 100/);
  await assert.rejects(store.put({ ...a }, { if: [{ any: [] }] }), /any clause/);
  await assert.rejects(store.transact([{ check: a, if: [] }]), /check needs a condition/);
  assert.deepEqual((await store.query({ pk, prefix: 'TXN#2026-05' })).items, [], 'nothing of a refused transaction landed');
  await assert.rejects(store.query({ pk, prefix: PREFIX.TXN, between: ['a', 'b'] }), /prefix or between/);
  await assert.rejects(store.query({ prefix: PREFIX.TXN }), /pk/);

  // Files and calls.
  const upload = uploadKey('sub-a', '01JAAAAAAAAAAAAAAAAAAAAAAA');
  const form = await store.presignPost(upload, { maxBytes: 5 * 1024 * 1024, expiresSeconds: 900 });
  assert.equal(form.fields.key, upload);
  store.putObject(upload, Buffer.from('file'));
  store.putObject(uploadKey('sub-b', 'x'), Buffer.from('other'));
  assert.equal((await store.getObject(upload)).toString(), 'file');
  assert.equal(await store.getObject('uploads/sub-a/missing'), undefined);
  assert.deepEqual(await store.listKeys('uploads/sub-a/'), [upload]);
  await store.deleteObjects([upload]);
  assert.deepEqual(await store.listKeys('uploads/sub-a/'), []);
  await store.deleteObject(uploadKey('sub-b', 'x'));
  assert.deepEqual(await store.listKeys('uploads/'), []);
  await store.invokeAsync('smart-finances-dev-parser', { sub: 'sub-a', import_id: 'x' });
  assert.deepEqual(store.invocations, [{ functionName: 'smart-finances-dev-parser', payload: { sub: 'sub-a', import_id: 'x' } }]);
});

// A stub of the DynamoDB document client, S3 and Lambda: records each command and answers from a script.
function stubClient(answer = () => ({})) {
  const sent = [];
  return {
    sent,
    send: async (command) => {
      sent.push({ name: command.constructor.name, input: command.input });
      return answer(command.constructor.name, command.input);
    },
  };
}

const awsError = (name, extra = {}) => Object.assign(new Error(name), { name, ...extra });

test('T-KEY-3 repo.mjs turns conditions into a ConditionExpression and a cancelled transaction into ConditionFailed with the index', async () => {
  assert.equal(RepoConditionFailed, ConditionFailed, 'both stores throw the same error class');

  const ddb = stubClient();
  const repo = createRepo({ ddb, s3: stubClient(), lambda: stubClient(), tableName: 'table-x', bucketName: 'bucket-x' });
  const a = txnKey('sub-a', '2026-03-15', 'aaaaaaaaaaaaaaaa');

  await repo.put({ ...a, computed_at: 9 }, {
    if: [{ any: [{ attr: 'pk', exists: false }, { attr: 'computed_at', op: '<', value: 9 }] }, { attr: 'status', op: '=', value: 'requested' }],
  });
  const put = ddb.sent.at(-1);
  assert.equal(put.name, 'PutCommand');
  assert.equal(put.input.TableName, 'table-x');
  assert.deepEqual(put.input.Item, { ...a, computed_at: 9 });
  assert.equal(put.input.ConditionExpression, '(attribute_not_exists(#n0) OR #n1 < :v0) AND #n2 = :v1');
  assert.deepEqual(put.input.ExpressionAttributeNames, { '#n0': 'pk', '#n1': 'computed_at', '#n2': 'status' });
  assert.deepEqual(put.input.ExpressionAttributeValues, { ':v0': 9, ':v1': 'requested' });

  await repo.put({ ...a });
  assert.equal(ddb.sent.at(-1).input.ConditionExpression, undefined, 'no condition, no expression');

  await repo.remove(a, { if: [{ attr: 'lock_import', exists: true }] });
  assert.equal(ddb.sent.at(-1).name, 'DeleteCommand');
  assert.equal(ddb.sent.at(-1).input.ConditionExpression, 'attribute_exists(#n0)');

  await repo.get(a, { consistent: true });
  assert.deepEqual(ddb.sent.at(-1).input, { TableName: 'table-x', Key: a, ConsistentRead: true });

  // A failed single-item condition is ConditionFailed without an index.
  const failing = stubClient((name) => {
    if (name === 'PutCommand') throw awsError('ConditionalCheckFailedException');
    if (name === 'TransactWriteCommand') {
      throw awsError('TransactionCanceledException', {
        CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
      });
    }
    return {};
  });
  const failingRepo = createRepo({ ddb: failing, s3: stubClient(), lambda: stubClient(), tableName: 'table-x', bucketName: 'bucket-x' });
  await assert.rejects(failingRepo.put({ ...a }, { if: [{ attr: 'pk', exists: false }] }), (err) => err instanceof ConditionFailed && err.index === undefined);

  // A cancelled transaction names the item whose condition failed.
  const imp = impKey('sub-a', '01JAAAAAAAAAAAAAAAAAAAAAAA');
  await assert.rejects(
    failingRepo.transact([
      { put: { ...imp, status: 'importing' }, if: [{ attr: 'status', op: '=', value: 'requested' }] },
      { check: erasedKey('sub-a'), if: [{ attr: 'pk', exists: false }] },
      { remove: a },
    ]),
    (err) => err instanceof ConditionFailed && err.index === 1,
  );
  const tx = failing.sent.at(-1).input.TransactItems;
  assert.equal(tx[0].Put.ConditionExpression, '#n0 = :v0');
  assert.deepEqual(tx[0].Put.ExpressionAttributeValues, { ':v0': 'requested' });
  assert.deepEqual(tx[1].ConditionCheck, {
    TableName: 'table-x',
    Key: erasedKey('sub-a'),
    ConditionExpression: 'attribute_not_exists(#n0)',
    ExpressionAttributeNames: { '#n0': 'pk' },
  });
  assert.deepEqual(tx[2].Delete, { TableName: 'table-x', Key: a });
  await assert.rejects(repo.transact([{ check: a }]), /check needs a condition/);
  await assert.rejects(repo.transact([]), /1 to 100/);
  await assert.rejects(repo.put({ ...a }, { if: [{ any: [] }] }), /any clause/);
  await assert.rejects(repo.query({ pk: personPk('sub-a'), prefix: '' }), /non-empty/);

  // Other errors pass through unchanged.
  const throttled = stubClient(() => { throw awsError('ProvisionedThroughputExceededException'); });
  const throttledRepo = createRepo({ ddb: throttled, s3: stubClient(), lambda: stubClient(), tableName: 'table-x', bucketName: 'bucket-x' });
  await assert.rejects(throttledRepo.put({ ...a }), { name: 'ProvisionedThroughputExceededException' });

  // Queries: key conditions for prefix and range, paging through cursors.
  const pages = [
    { Items: [{ ...a }], LastEvaluatedKey: a },
    { Items: [{ ...txnKey('sub-a', '2026-03-16', 'bbbbbbbbbbbbbbbb') }] },
  ];
  const querying = stubClient((name) => (name === 'QueryCommand' ? pages.shift() : {}));
  const queryRepo = createRepo({ ddb: querying, s3: stubClient(), lambda: stubClient(), tableName: 'table-x', bucketName: 'bucket-x' });
  const all = await queryRepo.query({ pk: personPk('sub-a'), between: monthRange(PREFIX.TXN, '2026-03', '2026-03'), consistent: true });
  assert.equal(all.items.length, 2, 'without a limit every page is read');
  assert.equal(all.cursor, undefined);
  const [first, second] = querying.sent.map((x) => x.input);
  assert.equal(first.KeyConditionExpression, '#pk = :pk AND #sk BETWEEN :lo AND :hi');
  assert.deepEqual(first.ExpressionAttributeValues, { ':pk': 'U#sub-a', ':lo': 'TXN#2026-03', ':hi': 'TXN#2026-03~' });
  assert.equal(first.ConsistentRead, true);
  assert.deepEqual(second.ExclusiveStartKey, a);

  pages.push({ Items: [{ ...a }] });
  await queryRepo.query({ pk: personPk('sub-a') });
  assert.equal(querying.sent.at(-1).input.KeyConditionExpression, '#pk = :pk', 'the whole partition');
  assert.deepEqual(querying.sent.at(-1).input.ExpressionAttributeNames, { '#pk': 'pk' });

  pages.push({ Items: [{ ...a }], LastEvaluatedKey: a });
  const page = await queryRepo.query({ pk: personPk('sub-a'), prefix: PREFIX.TXN, limit: 1 });
  const sent = querying.sent.at(-1).input;
  assert.equal(sent.KeyConditionExpression, '#pk = :pk AND begins_with(#sk, :prefix)');
  assert.equal(sent.Limit, 1);
  assert.ok(page.cursor);
  pages.push({ Items: [] });
  await queryRepo.query({ pk: personPk('sub-a'), prefix: PREFIX.TXN, limit: 1, cursor: page.cursor });
  assert.deepEqual(querying.sent.at(-1).input.ExclusiveStartKey, a, 'the cursor resumes where the page ended');

  // Files and calls. listKeys follows continuation tokens to the last page.
  const s3 = stubClient((name, input) => {
    if (name === 'ListObjectsV2Command') {
      return input.ContinuationToken
        ? { Contents: [{ Key: 'uploads/sub-a/x' }], IsTruncated: false }
        : { Contents: [{ Key: 'uploads/sub-a/w' }], IsTruncated: true, NextContinuationToken: 'next' };
    }
    if (name === 'GetObjectCommand') return { Body: { transformToByteArray: async () => new TextEncoder().encode('file') } };
    if (name === 'DeleteObjectsCommand') return {};
    return {};
  });
  const lambda = stubClient();
  const files = createRepo({ ddb: stubClient(), s3, lambda, tableName: 'table-x', bucketName: 'bucket-x' });
  assert.deepEqual(await files.listKeys('uploads/sub-a/'), ['uploads/sub-a/w', 'uploads/sub-a/x']);
  assert.deepEqual(s3.sent.at(-2).input, { Bucket: 'bucket-x', Prefix: 'uploads/sub-a/' });
  assert.deepEqual(s3.sent.at(-1).input, { Bucket: 'bucket-x', Prefix: 'uploads/sub-a/', ContinuationToken: 'next' });
  assert.equal((await files.getObject('uploads/sub-a/x')).toString(), 'file');
  await files.deleteObjects(['uploads/sub-a/x']);
  assert.deepEqual(s3.sent.at(-1).input, { Bucket: 'bucket-x', Delete: { Objects: [{ Key: 'uploads/sub-a/x' }], Quiet: true } });
  // deleteObjects sends at most 1,000 keys per request, and a partial failure throws.
  const many = Array.from({ length: 1001 }, (_, i) => `uploads/sub-a/${i}`);
  const before = s3.sent.length;
  await files.deleteObjects(many);
  const batches = s3.sent.slice(before).map((x) => x.input.Delete.Objects.length);
  assert.deepEqual(batches, [1000, 1]);
  const partial = createRepo({
    ddb: stubClient(),
    s3: stubClient(() => ({ Errors: [{ Key: 'uploads/sub-a/x', Code: 'AccessDenied' }] })),
    lambda: stubClient(),
    tableName: 'table-x',
    bucketName: 'bucket-x',
  });
  await assert.rejects(partial.deleteObjects(['uploads/sub-a/x']), /could not delete 1 objects/);
  await files.deleteObject('uploads/sub-a/x');
  assert.deepEqual(s3.sent.at(-1).input, { Bucket: 'bucket-x', Key: 'uploads/sub-a/x' });
  await files.invokeAsync('smart-finances-dev-rollup', { sub: 'sub-a', months: 'all' });
  assert.equal(lambda.sent.at(-1).input.FunctionName, 'smart-finances-dev-rollup');
  assert.equal(lambda.sent.at(-1).input.InvocationType, 'Event');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(lambda.sent.at(-1).input.Payload)), { sub: 'sub-a', months: 'all' });

  // The upload form allows exactly one key and 1 byte to maxBytes, and expires. Signed offline.
  const signer = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'example' } });
  const signing = createRepo({ ddb: stubClient(), s3: signer, lambda: stubClient(), tableName: 'table-x', bucketName: 'bucket-x' });
  const upload = uploadKey('sub-a', '01JAAAAAAAAAAAAAAAAAAAAAAA');
  const startedAt = Date.now();
  const form = await signing.presignPost(upload, { maxBytes: 5 * 1024 * 1024, expiresSeconds: 900 });
  assert.equal(form.fields.key, upload);
  const policy = JSON.parse(Buffer.from(form.fields.Policy, 'base64').toString('utf8'));
  assert.ok(policy.conditions.some((c) => Array.isArray(c) && c[0] === 'content-length-range' && c[1] === 1 && c[2] === 5 * 1024 * 1024));
  assert.ok(policy.conditions.some((c) => c.key === upload || (Array.isArray(c) && c[0] === 'eq' && c[1] === '$key' && c[2] === upload)));
  assert.ok(policy.conditions.some((c) => c.bucket === 'bucket-x'));
  const expiresIn = (Date.parse(policy.expiration) - startedAt) / 1000;
  assert.ok(expiresIn > 890 && expiresIn <= 901, `expires in about 15 minutes, got ${expiresIn}s`);

  const missing = createRepo({
    ddb: stubClient(),
    s3: stubClient(() => { throw awsError('NoSuchKey'); }),
    lambda: stubClient(),
    tableName: 'table-x',
    bucketName: 'bucket-x',
  });
  assert.equal(await missing.getObject('uploads/sub-a/gone'), undefined);

  // The table and bucket names come from the environment by default.
  process.env.TABLE_NAME = 'table-env';
  process.env.BUCKET_NAME = 'bucket-env';
  const envDdb = stubClient();
  const envS3 = stubClient(() => ({ Contents: [] }));
  const fromEnv = createRepo({ ddb: envDdb, s3: envS3, lambda: stubClient() });
  await fromEnv.get(a);
  await fromEnv.listKeys('uploads/sub-a/');
  assert.equal(envDdb.sent.at(-1).input.TableName, 'table-env');
  assert.equal(envS3.sent.at(-1).input.Bucket, 'bucket-env');
});
