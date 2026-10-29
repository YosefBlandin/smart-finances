// In-memory store with the same interface as repo.mjs, so the core modules and handlers are
// tested without AWS. It keeps DynamoDB's semantics where they matter for correctness:
// conditions, all-or-nothing transactions, sort-key order and paging.

// Thrown when a condition does not hold. In a transaction, index names the failed item.
export class ConditionFailed extends Error {
  constructor(index) {
    super(index === undefined ? 'condition failed' : `condition failed on transaction item ${index}`);
    this.name = 'ConditionFailed';
    this.index = index;
  }
}

const COMPARE = {
  '=': (a, b) => a === b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
};

// A condition is a list of clauses that must all hold:
// { attr, exists: bool } | { attr, op, value } | { any: [clauses] }.
export function holds(item, clauses = []) {
  return clauses.every((clause) => holdsOne(item, clause));
}

function holdsOne(item, clause) {
  if (clause.any) {
    if (!clause.any.length) throw new Error('an any clause needs at least one clause');
    return clause.any.some((inner) => holdsOne(item, inner));
  }
  const value = item?.[clause.attr];
  if ('exists' in clause) return clause.exists === (value !== undefined);
  const compare = COMPARE[clause.op];
  if (!compare) throw new Error(`unknown condition op: ${clause.op}`);
  // As in DynamoDB, a missing attribute or a type mismatch makes a comparison false.
  if (value === undefined || typeof value !== typeof clause.value) return false;
  return compare(value, clause.value);
}

// Requests DynamoDB refuses are refused here too, so a test cannot pass on something AWS rejects.
export function checkQuery({ pk, prefix, between }) {
  if (typeof pk !== 'string' || !pk) throw new Error('query needs a pk');
  if (prefix !== undefined && between !== undefined) throw new Error('query takes a prefix or between, not both');
  if (prefix !== undefined && (typeof prefix !== 'string' || !prefix)) throw new Error('query prefix must be a non-empty string');
  if (between !== undefined && !(between.length === 2 && between.every((b) => typeof b === 'string' && b) && between[0] <= between[1])) {
    throw new Error('query between needs two non-empty bounds, low first');
  }
}

export function checkTransaction(ops) {
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > 100) throw new Error('a transaction holds 1 to 100 items');
}

const id = ({ pk, sk }) => `${pk}\u0000${sk}`;
const copy = (value) => (value === undefined ? undefined : structuredClone(value));
const encode = (sk) => Buffer.from(JSON.stringify({ sk })).toString('base64url');
const decode = (cursor) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')).sk;

export function createMemoryStore() {
  const items = new Map();
  const objects = new Map();
  const invocations = [];

  const requireKey = (key) => {
    if (typeof key?.pk !== 'string' || typeof key?.sk !== 'string') throw new Error('an item needs string pk and sk');
    return { pk: key.pk, sk: key.sk };
  };

  return {
    items,
    objects,
    invocations,

    async get(key) {
      return copy(items.get(id(requireKey(key))));
    },

    async put(item, { if: condition } = {}) {
      const key = requireKey(item);
      if (!holds(items.get(id(key)), condition)) throw new ConditionFailed();
      items.set(id(key), copy(item));
    },

    async remove(key, { if: condition } = {}) {
      const k = requireKey(key);
      if (!holds(items.get(id(k)), condition)) throw new ConditionFailed();
      items.delete(id(k));
    },

    // With neither prefix nor between, the whole partition (for delete-all).
    async query({ pk, prefix, between, limit, cursor } = {}) {
      checkQuery({ pk, prefix, between });
      const inside = prefix !== undefined
        ? (sk) => sk.startsWith(prefix)
        : between !== undefined
          ? (sk) => sk >= between[0] && sk <= between[1]
          : () => true;
      const after = cursor === undefined ? undefined : decode(cursor);
      const found = [...items.values()]
        .filter((item) => item.pk === pk && inside(item.sk) && (after === undefined || item.sk > after))
        .sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0));
      const page = limit === undefined ? found : found.slice(0, limit);
      // Like DynamoDB, a full page always carries a cursor, even when nothing follows it.
      const full = limit !== undefined && page.length === limit && page.length > 0;
      return { items: page.map(copy), cursor: full ? encode(page.at(-1).sk) : undefined };
    },

    // ops: [{ put: item, if } | { remove: key, if } | { check: key, if }]. Every condition is
    // checked before anything is written, so a failure leaves the store unchanged.
    async transact(ops) {
      checkTransaction(ops);
      const seen = new Set();
      ops.forEach((op, index) => {
        const key = requireKey(op.put ?? op.remove ?? op.check);
        if (seen.has(id(key))) throw new Error('one item twice in a transaction');
        seen.add(id(key));
        if (op.check && !op.if?.length) throw new Error('a check needs a condition');
        if (!holds(items.get(id(key)), op.if)) throw new ConditionFailed(index);
      });
      for (const op of ops) {
        if (op.put) items.set(id(op.put), copy(op.put));
        if (op.remove) items.delete(id(op.remove));
      }
    },

    async presignPost(key, { maxBytes, expiresSeconds }) {
      return {
        url: 'https://uploads.example.invalid/',
        fields: { key, 'x-max-bytes': String(maxBytes), 'x-expires-seconds': String(expiresSeconds) },
      };
    },

    // Test helper: an object as if the browser had posted it.
    putObject(key, body) {
      objects.set(key, Buffer.from(body));
    },

    async getObject(key) {
      return objects.has(key) ? Buffer.from(objects.get(key)) : undefined;
    },

    async deleteObject(key) {
      objects.delete(key);
    },

    async listKeys(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    },

    async deleteObjects(keys) {
      for (const key of keys) objects.delete(key);
    },

    async invokeAsync(functionName, payload) {
      invocations.push({ functionName, payload: copy(payload) });
    },
  };
}
