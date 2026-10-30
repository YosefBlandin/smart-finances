// The only place table keys and upload object keys are built (ADR 0004 "Table items").
// Every key starts from the person, so no caller can reach another person's partition by
// passing a crafted part: a part holding # or / is refused.

export const PREFIX = Object.freeze({
  TXN: 'TXN#',
  OVR: 'OVR#',
  IMP: 'IMP#',
  PER: 'PER#',
  RATE: 'RATE#',
  SUM: 'SUM#',
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function part(value, what) {
  if (typeof value !== 'string' || !value || /[#/]/.test(value)) {
    throw new Error(`bad key part for ${what}: must be a non-empty string without # or /`);
  }
  return value;
}

function match(value, pattern, what) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`bad ${what}: ${JSON.stringify(value)}`);
  return value;
}

const date = (value) => match(value, DATE, 'date (YYYY-MM-DD)');
const month = (value) => match(value, MONTH, 'month (yyyy-mm)');
const period = (value) => (value === 'log' ? value : match(value, MONTH, 'period (yyyy-mm or log)'));

export const personPk = (sub) => `U#${part(sub, 'person')}`;

const key = (sub, sk) => ({ pk: personPk(sub), sk });

export const txnKey = (sub, d, id) => key(sub, `${PREFIX.TXN}${date(d)}#${part(id, 'id')}`);
export const ovrKey = (sub, d, id) => key(sub, `${PREFIX.OVR}${date(d)}#${part(id, 'id')}`);
export const impKey = (sub, importId) => key(sub, `${PREFIX.IMP}${part(importId, 'import id')}`);
export const perKey = (sub, source, p) => key(sub, `${PREFIX.PER}${part(source, 'source')}#${period(p)}`);
export const rateKey = (sub, m) => key(sub, `${PREFIX.RATE}${month(m)}`);
export const sumKey = (sub, m) => key(sub, `${PREFIX.SUM}${month(m)}`);
export const erasedKey = (sub) => key(sub, 'ERASED');

export const uploadKey = (sub, importId) => `uploads/${part(sub, 'person')}/${part(importId, 'import id')}`;

// Sort-key bounds for a BETWEEN over whole months, both ends included. The upper bound ends in
// ~, which sorts after every date and id character, so TXN#<to>-31#<id> is still inside.
export function monthRange(prefix, from, to) {
  if (![PREFIX.TXN, PREFIX.OVR, PREFIX.RATE, PREFIX.SUM].includes(prefix)) throw new Error(`no month range for prefix ${prefix}`);
  if (month(from) > month(to)) throw new Error(`bad range: ${from} is after ${to}`);
  return [`${prefix}${from}`, `${prefix}${to}~`];
}
