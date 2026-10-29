// DynamoDB, S3 and Lambda behind the same small interface as memory.mjs. Handlers get one of
// the two and never call the SDK directly. Table and bucket names come from TABLE_NAME and
// BUCKET_NAME unless passed in; clients can be passed in so tests run against stubs.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { checkQuery, checkTransaction, ConditionFailed } from './memory.mjs';

// One error class for both stores, so callers catch the same thing in tests and in AWS.
export { ConditionFailed };

// Turns condition clauses into a ConditionExpression with placeholder names and values.
// Every attribute reference gets its own #nK and every value its own :vK.
export function conditionExpression(clauses) {
  if (!clauses?.length) return {};
  const names = {};
  const values = {};
  const name = (attr) => {
    const placeholder = `#n${Object.keys(names).length}`;
    names[placeholder] = attr;
    return placeholder;
  };
  const value = (v) => {
    const placeholder = `:v${Object.keys(values).length}`;
    values[placeholder] = v;
    return placeholder;
  };
  const render = (clause) => {
    if (clause.any) {
      if (!clause.any.length) throw new Error('an any clause needs at least one clause');
      return `(${clause.any.map(render).join(' OR ')})`;
    }
    if ('exists' in clause) return `${clause.exists ? 'attribute_exists' : 'attribute_not_exists'}(${name(clause.attr)})`;
    if (!['=', '<', '>', '<=', '>='].includes(clause.op)) throw new Error(`unknown condition op: ${clause.op}`);
    return `${name(clause.attr)} ${clause.op} ${value(clause.value)}`;
  };
  const expression = clauses.map(render).join(' AND ');
  return {
    ConditionExpression: expression,
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
  };
}

const encode = (key) => Buffer.from(JSON.stringify(key)).toString('base64url');
const decode = (cursor) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

function required(value, env) {
  const resolved = value ?? process.env[env];
  if (!resolved) throw new Error(`${env} is not set`);
  return resolved;
}

export function createRepo({ ddb, s3, lambda, tableName, bucketName } = {}) {
  const doc = ddb ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const files = s3 ?? new S3Client({});
  const calls = lambda ?? new LambdaClient({});
  const table = () => required(tableName, 'TABLE_NAME');
  const bucket = () => required(bucketName, 'BUCKET_NAME');

  const single = async (command) => {
    try {
      return await doc.send(command);
    } catch (err) {
      if (err?.name === 'ConditionalCheckFailedException') throw new ConditionFailed();
      throw err;
    }
  };

  return {
    async get(key, { consistent } = {}) {
      const out = await doc.send(new GetCommand({ TableName: table(), Key: { pk: key.pk, sk: key.sk }, ConsistentRead: Boolean(consistent) }));
      return out.Item;
    },

    async put(item, { if: condition } = {}) {
      await single(new PutCommand({ TableName: table(), Item: item, ...conditionExpression(condition) }));
    },

    async remove(key, { if: condition } = {}) {
      await single(new DeleteCommand({ TableName: table(), Key: { pk: key.pk, sk: key.sk }, ...conditionExpression(condition) }));
    },

    // Without a limit every page is read; with one, a single page and a cursor when it is full.
    // With neither prefix nor between, the whole partition (for delete-all).
    async query({ pk, prefix, between, consistent, limit, cursor } = {}) {
      checkQuery({ pk, prefix, between, limit });
      const range = prefix !== undefined
        ? { KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)', ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix } }
        : between !== undefined
          ? { KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :lo AND :hi', ExpressionAttributeValues: { ':pk': pk, ':lo': between[0], ':hi': between[1] } }
          : { KeyConditionExpression: '#pk = :pk', ExpressionAttributeValues: { ':pk': pk } };
      const items = [];
      let start = cursor === undefined ? undefined : decode(cursor);
      do {
        const out = await doc.send(new QueryCommand({
          TableName: table(),
          ...range,
          ExpressionAttributeNames: prefix === undefined && between === undefined ? { '#pk': 'pk' } : { '#pk': 'pk', '#sk': 'sk' },
          ConsistentRead: Boolean(consistent),
          ...(limit !== undefined ? { Limit: limit } : {}),
          ...(start ? { ExclusiveStartKey: start } : {}),
        }));
        items.push(...(out.Items ?? []));
        start = out.LastEvaluatedKey;
      } while (start && limit === undefined);
      return { items, cursor: start ? encode(start) : undefined };
    },

    // ops: [{ put: item, if } | { remove: key, if } | { check: key, if }], all or nothing.
    async transact(ops) {
      checkTransaction(ops);
      const TransactItems = ops.map((op) => {
        const TableName = table();
        const condition = conditionExpression(op.if);
        if (op.put) return { Put: { TableName, Item: op.put, ...condition } };
        if (op.remove) return { Delete: { TableName, Key: { pk: op.remove.pk, sk: op.remove.sk }, ...condition } };
        if (!op.if?.length) throw new Error('a check needs a condition');
        return { ConditionCheck: { TableName, Key: { pk: op.check.pk, sk: op.check.sk }, ...condition } };
      });
      try {
        await doc.send(new TransactWriteCommand({ TransactItems }));
      } catch (err) {
        if (err?.name === 'TransactionCanceledException') {
          const index = (err.CancellationReasons ?? []).findIndex((reason) => reason?.Code === 'ConditionalCheckFailed');
          if (index >= 0) throw new ConditionFailed(index);
        }
        throw err;
      }
    },

    // A form that accepts exactly this key and 1 byte to maxBytes, signed with this function's role.
    async presignPost(key, { maxBytes, expiresSeconds }) {
      return createPresignedPost(files, {
        Bucket: bucket(),
        Key: key,
        Conditions: [['content-length-range', 1, maxBytes]],
        Expires: expiresSeconds,
      });
    },

    async getObject(key) {
      try {
        const out = await files.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
        return Buffer.from(await out.Body.transformToByteArray());
      } catch (err) {
        if (err?.name === 'NoSuchKey') return undefined;
        throw err;
      }
    },

    async deleteObject(key) {
      await files.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    },

    async listKeys(prefix) {
      const keys = [];
      let token;
      do {
        const out = await files.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ...(token ? { ContinuationToken: token } : {}) }));
        keys.push(...(out.Contents ?? []).map((object) => object.Key));
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },

    async deleteObjects(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const Objects = keys.slice(i, i + 1000).map((Key) => ({ Key }));
        const out = await files.send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects, Quiet: true } }));
        if (out.Errors?.length) throw new Error(`could not delete ${out.Errors.length} objects`);
      }
    },

    async invokeAsync(functionName, payload) {
      await calls.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }));
    },
  };
}
