import { merchantCategory } from '@smart-finances/contracts/rules';

// Category suggestions for payments review rows (category-suggestions D-17, D-18): pure code, no React, no I/O and no
// globals. History examples are indexed by recipient key, cleaned shop name, word and kind; each row is matched level by
// level (same key, same name, the import rules, shared words, then an optional model), and within a level the owner's
// own examples beat rule-categorized ones (D-11). Shop names are only ever compared as cleaned tokens, never shown or
// evaluated (AC-20), and nothing here throws or logs row text.

/** The source whose rows can take a choice (the same value as screens/review/View.tsx CHOICE_SOURCE; D-9). */
export const SUGGEST_SOURCE = 'mercadopago';
const UNCATEGORIZED = 'Uncategorized';

export type Example = { key: string; name: string; category: string; owner: boolean; kind: string; date: string };
export type Index = {
  byKey: Map<string, Example[]>;
  byName: Map<string, Example[]>;
  byToken: Map<string, Example[]>;
  /** The owner's examples counted by category, per kind of row. */
  byKind: Map<string, Map<string, number>>;
};
export type Level = 'key' | 'name' | 'rule' | 'words' | 'model';
/** others.length <= 2, all distinct from pick. */
export type Suggestion = { pick: string; others: string[]; level: Level };
export type SuggestRow = { id: string; source: string; merchant: string; recipient_key: string; kind: string; category: string };
export type HistoryRow = SuggestRow & { date: string; review: { approved: boolean; category_override?: string } };
export type ModelScorer = (row: { name: string }) => { category: string; score: number }[];

/** A choice made on this page sorts after every history date, so it is the most recent example. */
const SESSION_DATE = '9999-12-31';
const MAX_NAME = 80;
const MIN_TOKEN = 3;
const MIN_JACCARD = 0.5;
const MAX_OTHERS = 2;
const STOP_WORDS = new Set([
  'sa',
  'srl',
  'sas',
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'en',
  'con',
  'por',
  'para',
  'the',
  'and',
  'pago',
  'pagos',
  'compra',
  'compras',
  'com',
  'www',
]);

/** Accents, case and punctuation off, processor prefixes and digit-only tokens dropped, at most 80 characters. */
export function cleanName(merchant: string): string {
  const plain = String(merchant ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s*(?:mp|merpago|mercadopago)\s*\*/, ' ');
  return plain
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token) => token !== '' && !/^\p{N}+$/u.test(token))
    .join(' ')
    .slice(0, MAX_NAME)
    .trim();
}

function tokens(name: string): Set<string> {
  return new Set(name.split(' ').filter((t) => t.length >= MIN_TOKEN && !STOP_WORDS.has(t)));
}

/** History rows to examples: categorized rows with a recipient key or a merchant; approved or overridden ones are the owner's. */
export function examplesFrom(rows: HistoryRow[]): Example[] {
  const out: Example[] = [];
  for (const row of rows) {
    if (!row.category || row.category === UNCATEGORIZED) continue;
    const key = row.recipient_key ?? '';
    const name = cleanName(row.merchant ?? '');
    if (!key && !name) continue;
    const owner = Boolean(row.review?.approved) || row.review?.category_override !== undefined;
    out.push({ key, name, category: row.category, owner, kind: row.kind, date: row.date });
  }
  return out;
}

const push = (map: Map<string, Example[]>, at: string, example: Example) => {
  const list = map.get(at);
  if (list) list.push(example);
  else map.set(at, [example]);
};

function addTo(index: Index, example: Example): void {
  if (example.key) push(index.byKey, example.key, example);
  if (example.name) {
    push(index.byName, example.name, example);
    for (const token of tokens(example.name)) push(index.byToken, token, example);
  }
  if (example.owner) {
    const counts = index.byKind.get(example.kind) ?? new Map<string, number>();
    counts.set(example.category, (counts.get(example.category) ?? 0) + 1);
    index.byKind.set(example.kind, counts);
  }
}

export function buildIndex(examples: Example[]): Index {
  const index: Index = { byKey: new Map(), byName: new Map(), byToken: new Map(), byKind: new Map() };
  for (const example of examples) addTo(index, example);
  return index;
}

/** A new index with the choice added as the owner's most recent example; the given index is left as it was. */
export function addChoice(index: Index, row: SuggestRow, category: string): Index {
  const example: Example = {
    key: row.recipient_key ?? '',
    name: cleanName(row.merchant ?? ''),
    category,
    owner: true,
    kind: row.kind,
    date: SESSION_DATE,
  };
  const copyList = (map: Map<string, Example[]>, keys: Iterable<string>) => {
    const next = new Map(map);
    for (const k of keys) next.set(k, [...(map.get(k) ?? [])]);
    return next;
  };
  const next: Index = {
    byKey: example.key ? copyList(index.byKey, [example.key]) : index.byKey,
    byName: example.name ? copyList(index.byName, [example.name]) : index.byName,
    byToken: example.name ? copyList(index.byToken, tokens(example.name)) : index.byToken,
    byKind: new Map([...index.byKind].map(([kind, counts]) => [kind, kind === example.kind ? new Map(counts) : counts])),
  };
  addTo(next, example);
  return next;
}

/** A level's categories in rank order: the owner's examples if the level has any, else the rule ones; most frequent, then most recent. */
function rank(examples: Example[]): string[] {
  const owner = examples.filter((e) => e.owner);
  const group = owner.length > 0 ? owner : examples;
  const stats = new Map<string, { count: number; last: string }>();
  for (const e of group) {
    if (e.category === UNCATEGORIZED) continue;
    const s = stats.get(e.category) ?? { count: 0, last: '' };
    s.count += 1;
    if (e.date > s.last) s.last = e.date;
    stats.set(e.category, s);
  }
  return [...stats].sort(([, a], [, b]) => b.count - a.count || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0)).map(([category]) => category);
}

function wordMatches(name: string, index: Index): Example[] {
  const mine = tokens(name);
  if (mine.size === 0) return [];
  const seen = new Set<string>();
  const out: Example[] = [];
  for (const token of mine) {
    for (const e of index.byToken.get(token) ?? []) {
      if (!seen.has(e.name)) {
        seen.add(e.name);
        const theirs = tokens(e.name);
        let shared = 0;
        for (const t of theirs) if (mine.has(t)) shared += 1;
        const union = mine.size + theirs.size - shared;
        if (union > 0 && shared / union >= MIN_JACCARD) out.push(...(index.byName.get(e.name) ?? []));
      }
    }
  }
  return out;
}

function ownerMostUsed(index: Index, kind: string): string[] {
  const counts = index.byKind.get(kind);
  if (!counts) return [];
  return [...counts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0)).map(([category]) => category);
}

/**
 * The suggestion for each payments row, keyed by row id; rows without a pick are absent. A pick comes only from a
 * match on the row's own key or name (levels 1 to 5); others are the next distinct categories from lower matches, then
 * the owner's most used categories for the row's kind. The model is asked only for rows no other level placed (D-26).
 */
export function suggest(rows: SuggestRow[], index: Index, model?: ModelScorer): Map<string, Suggestion> {
  const out = new Map<string, Suggestion>();
  for (const row of rows) {
    if (row.source !== SUGGEST_SOURCE) continue;
    const name = cleanName(row.merchant ?? '');
    const rule = merchantCategory({ merchant: row.merchant ?? '' });
    const levels: [Level, string[]][] = [
      ['key', row.recipient_key ? rank(index.byKey.get(row.recipient_key) ?? []) : []],
      ['name', name ? rank(index.byName.get(name) ?? []) : []],
      ['rule', rule ? [rule] : []],
      ['words', name ? rank(wordMatches(name, index)) : []],
    ];
    let at = levels.findIndex(([, list]) => list.length > 0);
    if (at === -1 && model && name) {
      const scored = model({ name })
        .filter((s) => s.category !== UNCATEGORIZED)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.category);
      levels.push(['model', scored]);
      at = scored.length > 0 ? levels.length - 1 : -1;
    }
    if (at === -1) continue;
    const [level, first] = levels[at]!;
    const ordered = [...first, ...levels.slice(at + 1).flatMap(([, list]) => list), ...ownerMostUsed(index, row.kind)];
    const distinct = [...new Set(ordered.filter((c) => c !== UNCATEGORIZED))];
    const [pick, ...rest] = distinct;
    if (!pick) continue;
    out.set(row.id, { pick, others: rest.slice(0, MAX_OTHERS), level });
  }
  return out;
}
