# Synthetic data

Deterministic fake bank/wallet export for development, evals and the public demo. This repo never contains real financial data (`data/real/` is git-ignored).

```
npm run data:generate     # from the repo root; same seed -> identical files
```

| File | What it is |
| --- | --- |
| `transactions.csv` | What the importer sees: `date,description,amount,currency,account` |
| `ground-truth.csv` | What the evals use: `row,iso_date,category,is_duplicate,is_adversarial` (row = data row number, header excluded) |

## What is in it

- 12 months (Oct 2025 to Sep 2026), 663 rows, ARS and USD mixed, two accounts
- Messy merchant text: random case, prefixes (`COMPRA`, `MP*`), reference codes, padding
- ~15% of dates written `DD/MM/YYYY` instead of ISO. Day-first is the convention for this dataset, so the importer must parse it that way
- 20 exact duplicate rows (`is_duplicate=true`) that ingestion must collapse
- 8 adversarial rows (`is_adversarial=true`): spreadsheet formula injection, prompt-injection text, an HTML payload and a 2,000-character description. They must be stored and shown as inert text and never executed or obeyed

## Correct answers for evals

Compute expected numbers from `ground-truth.csv` joined to `transactions.csv`, skipping rows where `is_duplicate=true`. Never hard-code expected totals in test files.
