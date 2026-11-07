// Minimal .xlsx reader: enough to get cell values out of a workbook, with no dependencies.
// An .xlsx file is a zip of XML parts. Uploads are untrusted, so sizes are capped before
// anything is inflated (zip bombs) and formulas are returned as their cached values only.
import { inflateRawSync } from 'node:zlib';

const MAX_FILE = 20 * 1024 * 1024;
const MAX_PART = 50 * 1024 * 1024;
// D-25: caps on the zip as a whole, checked before anything is inflated.
const MAX_ENTRIES = 500;
const MAX_INFLATED = 100 * 1024 * 1024;

// Reads the central directory only. Parts are inflated on first use, so parts the reader never
// asks for (styles, images, anything else in the zip) are never inflated.
function unzip(buf) {
  if (buf.length > MAX_FILE) throw new Error('xlsx file is too large');
  // End of central directory: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not an xlsx (zip) file');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error(`xlsx has too many zip entries (${count}, at most ${MAX_ENTRIES})`);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let declared = 0;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (size > MAX_PART) throw new Error(`xlsx part ${name} is too large`);
    declared += size;
    entries.set(name, { name, method, compressed, local });
  }
  if (declared > MAX_INFLATED) throw new Error('xlsx parts add up past the total inflated size limit');

  // Headers can lie about sizes, so the real inflated bytes are counted against the same budget.
  let budget = MAX_INFLATED;
  const inflated = new Map();
  return {
    has: (name) => entries.has(name),
    get(name) {
      if (inflated.has(name)) return inflated.get(name);
      const e = entries.get(name);
      if (!e) return undefined;
      if (e.local + 30 > buf.length) throw new Error('corrupt zip local header');
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.compressed);
      let out;
      if (e.method === 0) out = data;
      else if (e.method === 8) {
        if (budget <= 0) throw new Error('xlsx inflated past the total size limit');
        const limit = Math.min(MAX_PART, budget);
        try {
          out = inflateRawSync(data, { maxOutputLength: limit });
        } catch (err) {
          if (err?.code === 'ERR_BUFFER_TOO_LARGE') {
            throw new Error(limit < MAX_PART ? 'xlsx inflated past the total size limit' : `xlsx part ${name} is too large`);
          }
          throw err;
        }
      } else throw new Error(`unsupported zip compression ${e.method} in ${name}`);
      if (out.length > budget) throw new Error('xlsx inflated past the total size limit');
      budget -= out.length;
      inflated.set(name, out);
      return out;
    },
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()],
  );
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
// Joins every <t> inside a fragment, which covers plain and rich-text strings.
const texts = (xml) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

// Returns { sheetName: { A1: value } }. Values are strings as stored: numbers and Excel date
// serials stay numeric strings, shared and inline strings are resolved.
export function readWorkbook(buf) {
  const parts = unzip(buf);
  const part = (name) => {
    const data = parts.get(name);
    if (!data) throw new Error(`xlsx is missing ${name}`);
    return data.toString('utf8');
  };
  const shared = parts.has('xl/sharedStrings.xml')
    ? [...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]))
    : [];
  const rels = new Map(
    [...part('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]),
  );

  const sheets = {};
  // Each sheet part is parsed once: a workbook that lists one part many times could otherwise
  // re-parse it without bound, past what the inflate caps allow for.
  const read = new Set();
  for (const [tag] of part('xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)) {
    const target = rels.get(attr(tag, 'r:id'));
    if (!target) throw new Error('xlsx sheet has no relationship target');
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    if (read.has(path)) throw new Error(`xlsx lists sheet part ${path} more than once`);
    read.add(path);
    const cells = {};
    for (const m of part(path).matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tagAttrs = ` ${m[1]}`;
      const ref = attr(tagAttrs, 'r');
      const type = attr(tagAttrs, 't');
      const body = m[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = null;
      if (type === 's' && v != null) value = shared[Number(v)];
      else if (type === 'inlineStr') value = texts(body);
      else if (v != null) value = decode(v);
      if (value != null && value !== '') cells[ref] = value;
    }
    sheets[decode(attr(tag, 'name'))] = cells;
  }
  return sheets;
}
