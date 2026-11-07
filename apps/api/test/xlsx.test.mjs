// T-IMP-3: hostile workbooks fail before anything big is inflated, and parts the reader does
// not need are never inflated (D-25). Every zip here is built in code; no binary fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { readWorkbook } from '../src/ingest/xlsx.mjs';

const MiB = 1024 * 1024;

// entries: [{ name, text | raw | data, method?, declaredSize? }]
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const raw = e.raw ?? Buffer.from(e.text ?? '', 'utf8');
    const method = e.method ?? 8;
    const data = e.data ?? (method === 8 ? deflateRawSync(raw) : raw);
    const size = e.declaredSize ?? raw.length;
    const nameBuf = Buffer.from(e.name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(size, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += head.length + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const sheetXml = (cells) => `<worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`;
function book(sheetCount = 1, sheetBody = () => sheetXml('<c r="A1" t="inlineStr"><is><t>hello</t></is></c>')) {
  const sheets = Array.from({ length: sheetCount }, (_, i) => i + 1);
  return [
    { name: 'xl/workbook.xml', text: `<workbook><sheets>${sheets.map((n) => `<sheet name="S${n}" sheetId="${n}" r:id="rId${n}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<Relationships>${sheets.map((n) => `<Relationship Id="rId${n}" Target="worksheets/sheet${n}.xml"/>`).join('')}</Relationships>` },
    ...sheets.map((n) => {
      const body = sheetBody(n);
      return { name: `xl/worksheets/sheet${n}.xml`, ...(typeof body === 'string' ? { text: body } : body) };
    }),
  ];
}

test('T-IMP-3 a plain workbook still reads', () => {
  assert.deepEqual(readWorkbook(zip(book())), { S1: { A1: 'hello' } });
});

test('T-IMP-3 more than 500 zip entries fail before anything is inflated', () => {
  const filler = Array.from({ length: 500 }, (_, i) => ({ name: `junk/${i}.bin`, text: 'x' }));
  // The sheet would throw if inflated (it is not deflate data), so the error proves the count came first.
  const entries = [...book(1, () => ({ data: Buffer.from('not deflate'), raw: Buffer.from('x') })), ...filler];
  assert.throws(() => readWorkbook(zip(entries)), /entries/);
});

test('T-IMP-3 exactly 500 entries are allowed', () => {
  const filler = Array.from({ length: 497 }, (_, i) => ({ name: `junk/${i}.bin`, text: 'x' }));
  assert.deepEqual(readWorkbook(zip([...book(), ...filler])), { S1: { A1: 'hello' } });
});

test('T-IMP-3 declared sizes over 100 MiB in total fail before inflating', () => {
  const entries = [...book(1, () => ({ data: Buffer.from('not deflate'), raw: Buffer.from('x') })),
    ...[1, 2, 3].map((n) => ({ name: `xl/media/big${n}.bin`, data: Buffer.from('z'), raw: Buffer.from('z'), declaredSize: 40 * MiB }))];
  assert.throws(() => readWorkbook(zip(entries)), /inflated/);
});

test('T-IMP-3 sheets that really inflate past 100 MiB in total fail, even when their headers lie', () => {
  const zeros = Buffer.alloc(40 * MiB, 0x20);
  const lying = (n) => ({ raw: Buffer.concat([Buffer.from(`<worksheet><sheetData/></worksheet><!--${n}`), zeros, Buffer.from('-->')]), declaredSize: 10 });
  assert.throws(() => readWorkbook(zip(book(3, lying))), /inflated|too large/);
});

test('T-IMP-3 parts the reader does not need are never inflated', () => {
  const bomb = { name: 'xl/media/image1.png', data: Buffer.from('this is not deflate data'), raw: Buffer.from('png') };
  const styles = { name: 'xl/styles.xml', data: Buffer.from('also broken'), raw: Buffer.from('s') };
  assert.deepEqual(readWorkbook(zip([...book(), bomb, styles])), { S1: { A1: 'hello' } });
});

test('T-IMP-3 the existing 50 MiB per-part and 20 MiB file caps stay', () => {
  const huge = { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('z'), raw: Buffer.from('z'), declaredSize: 51 * MiB };
  const [wb, rels] = book();
  assert.throws(() => readWorkbook(zip([wb, rels, huge])), /too large/);
  assert.throws(() => readWorkbook(Buffer.alloc(20 * MiB + 1)), /too large/);
});
