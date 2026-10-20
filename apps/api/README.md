# api

Lambda handlers: upload, ingestion, rollups, assistant tools. One IAM role per function (Epic 2, 4).

## Ingestion (`src/ingest/`)

Importers that turn each source into one transaction table (`schema.mjs` lists the fields). No dependencies, so the same modules can run in the ingestion Lambda later.

| Module | Source | What it proves |
| --- | --- | --- |
| `mercadopago.mjs` | Release report CSV from `scripts/mercadopago-report.mjs` | Running balance, printed closing balance, and that the kept rows explain the month's change. One row per operation, net of reserve holds |
| `notion.mjs` | The hand-written monthly log (USD, month-precision) | Every line is either imported or listed as skipped |
| `reconcile.mjs` | All of the above | Month-to-month balance chain, duplicates across files, totals by kind and category |

Run on your own files (reads and writes only git-ignored `data/real/`):

```
npm run ingest:local   # writes data/real/clean/transactions.csv and reconciliation.md
npm test               # importer tests, made-up fixtures only
```

Only `kind = expense` counts as spending. `inflow`, `transfer_out` and `loan_out` move money between your accounts or other people and stay in the table so balances still add up. Text cells that start like a formula are prefixed with `'` on export.
