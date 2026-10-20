#!/usr/bin/env node
// Runs the importers on your real files and writes the cleaned table plus a reconciliation
// report. Everything it reads and writes is under data/real/, which git ignores.
//
//   npm run ingest:local
//
// Reads:  data/real/mercadopago/*.csv  (release reports from scripts/mercadopago-report.mjs)
//         data/real/notion/*.md        (the Notion log, pasted as text)
// Writes: data/real/clean/transactions.csv and data/real/clean/reconciliation.md
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReleaseReport } from '../apps/api/src/ingest/mercadopago.mjs';
import { parseNotionLog } from '../apps/api/src/ingest/notion.mjs';
import { buildReport, combine } from '../apps/api/src/ingest/reconcile.mjs';
import { toCsv } from '../apps/api/src/ingest/schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = path.join(root, 'data/real');
const files = (dir, ext) =>
  existsSync(path.join(real, dir))
    ? readdirSync(path.join(real, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => [f, readFileSync(path.join(real, dir, f), 'utf8')])
    : [];

const mercadopago = files('mercadopago', '.csv').map(([f, text]) => parseReleaseReport(text, { file: f }));
const notion = files('notion', '.md').map(([f, text]) => parseNotionLog(text, { file: f }));
const combined = combine([...mercadopago, ...notion]);

const outDir = path.join(real, 'clean');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'transactions.csv'), toCsv(combined.transactions));
writeFileSync(path.join(outDir, 'reconciliation.md'), buildReport({ mercadopago, notion, combined }));

const failed = mercadopago.map((r) => r.check).filter((c) => c.balanceBreaks || !c.closingMatches || !c.monthNetMatches);
console.log(`${combined.transactions.length} transactions from ${mercadopago.length} Mercado Pago report(s) and ${notion.length} Notion log(s)`);
console.log(`wrote ${path.relative(root, outDir)}/transactions.csv and reconciliation.md`);
if (failed.length) {
  console.log(`balance checks FAILED for: ${failed.map((c) => c.file).join(', ')}`);
  process.exit(1);
}
