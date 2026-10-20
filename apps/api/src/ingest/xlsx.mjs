// Minimal .xlsx reader: enough to get cell values out of a workbook, with no dependencies.
// An .xlsx file is a zip of XML parts. Uploads are untrusted, so sizes are capped before
// anything is inflated (zip bombs) and formulas are returned as their cached values only.
import { inflateRawSync } from 'node:zlib';

const MAX_FILE = 20 * 1024 * 1024;
const MAX_PART = 50 * 1024 * 1024;

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
  let p = buf.readUInt32LE(eocd + 16);
  const parts = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
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
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (method === 0) parts.set(name, data);
    else if (method === 8) parts.set(name, inflateRawSync(data, { maxOutputLength: MAX_PART }));
    else throw new Error(`unsupported zip compression ${method} in ${name}`);
  }
  return parts;
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
  for (const [tag] of part('xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)) {
    const target = rels.get(attr(tag, 'r:id'));
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
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
