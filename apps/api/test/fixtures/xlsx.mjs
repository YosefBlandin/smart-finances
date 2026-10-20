// Builds a small but real .xlsx (zip of XML parts) from made-up cells, for tests.
import { crc32, deflateRawSync } from 'node:zlib';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += head.length + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// sheets: { name: { A1: value } }. Numbers become numeric cells; strings starting with '$'
// go through the shared-string table, other strings are inline.
export function makeXlsx(sheets) {
  const shared = [];
  const parts = {};
  const names = Object.keys(sheets);
  names.forEach((name, i) => {
    const cells = Object.entries(sheets[name])
      .map(([ref, v]) => {
        if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
        if (v.startsWith('$')) {
          shared.push(v.slice(1));
          return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
      })
      .join('');
    parts[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData><row>${cells}</row></sheetData></worksheet>`;
  });
  parts['xl/workbook.xml'] = `<workbook xmlns:r="r"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  parts['xl/_rels/workbook.xml.rels'] = `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
  parts['xl/sharedStrings.xml'] = `<sst>${shared.map((s) => `<si><r><t>${esc(s.slice(0, 2))}</t></r><r><t>${esc(s.slice(2))}</t></r></si>`).join('')}</sst>`;
  return zip(parts);
}
