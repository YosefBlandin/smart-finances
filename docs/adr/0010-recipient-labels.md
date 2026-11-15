# 0010: Mercado Pago enrichment and recipient labels

Status: accepted, 2026-11-15

Decision ids in this record are those of the mercadopago-enrichment spec (`docs/specs/mercadopago-enrichment/decisions.md`), not of the data-architecture spec that ADR 0004 cites.

## Context
Mercado Pago rows arrived with an empty merchant and almost always Uncategorized: the released-money report names no shop or person, and the importer's only rule was the Mercado Libre one. The payments search does name the shop and gives a category code for purchases, and the report itself can carry the sender's name for money received and the bank account for payouts. Those are names of people and shops the owner deals with, plus raw payment ids and account numbers. The question is where that data is joined, what reaches the server, and how one person or shop gets one name and category across all of its rows.

## Decisions
- **D-10**: Sync enriches each month on the owner's machine and appends three columns to the release report file; the uploaded file stays a release report the current upload path accepts.
- **D-11**: Recipient keys are made on the owner's machine with a keyed hash; the server never sees raw payments ids, account numbers or the hashing key.
- **D-12**: The hashing key is a random local file next to the reports, git-ignored, owner-only, created by sync on first use; losing it means relabeling.
- **D-13**: A label is stored once per recipient key and applied when rows are read; each label write starts a full totals rebuild.
- **D-14**: recipient_key becomes a shared transaction field, empty for other sources; the export gains one column.
- **D-15**: Mercado Pago expense categories come from the category code map, then merchant name rules, then the current rule, else Uncategorized; both lists live in a new module apart from the Notion rules.
- **D-16**: A month counts as fully synced only when its file has the enrichment columns; plain months are fetched again, a report made before the config change is requested anew, and the old file is set aside.
- **D-17**: If a payment search fails or passes 30 s, sync saves nothing for that month and reports it failed; the next run retries.
- **D-18**: A label's category beats a row's own review choice and the imported category; a label's name replaces the shown merchant and a label approves its rows.
- **D-19**: The report config default becomes the 15 live columns plus the payer name and payout account columns; the owner applies it once.
- **D-21**: The importer refuses a release report that still holds the payer name or payout account columns, and deletes that upload, so raw names and account numbers reach qa only through sync's cleaned file.
- **D-20**: ADR 0010 records the enrichment columns, recipient keys and read-time labels; the threat model gains the new assets and the owner's-machine boundary.

## What it looks like
- **Enrichment columns.** `scripts/mercadopago-sync.mjs` downloads the month, searches its payments as payer and as collector (30 s per request; a failure saves nothing for the month), and appends `SF_MERCHANT`, `SF_CATEGORY_CODE` and `SF_RECIPIENT` to every row of an operation. Values are cleaned so they can never break the `;` format: separators, quotes, line breaks and control characters become spaces, and the merchant is cut to 80 characters. Email addresses and phone or ID numbers are removed from names. The `PAYER_NAME` and `PAYOUT_BANK_ACCOUNT_NUMBER` columns are dropped before anything is saved, in `replaced/` and `rejected/` too.
- **Recipient key.** HMAC-SHA256 with the local hashing key (`data/real/mercadopago/.hashing-key`, 32 random bytes, mode 600) over `mp:<payments user id>` or `bank:<payout account number>`, lowercase hex, first 32 characters. The payer name is used as the merchant only for money received.
- **Importer.** `apps/api/src/ingest/mercadopago.mjs` reads the three columns (codes of four digits and keys of 32 hex only), sets the category from the category code map, then the merchant name rules (`apps/api/src/ingest/merchants.mjs`), then the Mercado Libre rule. In an enriched file an expense left Uncategorized goes on the review list. A file without the columns imports as before. A header holding a raw column fails the whole file with `private_columns`; on qa the parser deletes that upload.
- **Labels.** One item per recipient key, `LBL#<recipient_key>` in the person's partition (ADR 0004 "Table items"), written by `PUT /recipients/{key}/label` with the erase check in the same transaction. Every read that applies review choices (transactions, review, export, month totals) also reads the person's labels with one prefix query and applies them: the label's name is the shown merchant, its category beats the review choice's and the row's, and it approves the row. The rollup stream ignores `LBL#` items, so the route asks the rollup for a full rebuild; the rollup's async failures go to the RollupFailures queue and its alarm.

## Options

### Where the enrichment is joined (D-10, D-11)
- **On the owner's machine, during sync** (chosen): the server never calls the payments service and never sees raw ids or the hashing key; losing the key means relabeling.
- **On the server, in the parser**: raw ids would reach the uploaded file and the bucket, and the parser would need the payments token and a new secret grant.

### When a label reaches the rows (D-13)
- **One stored label, joined when rows are read** (chosen): one more small query per read; totals need a rebuild per label write.
- **A review choice written on every matching row**: hundreds of writes per label, and future rows would need the parser to write choices.
- **The label written into rows at import**: past rows would need a re-import, so labeling would not reach them at once.

### A label against a row's earlier choice (D-18)
- **The label's category wins** (chosen): every row of a labeled recipient follows it; relabeling is the way to change it.
- **The newer of label and choice wins**: needs choice times on every read and is harder to explain.

## Consequences
- Names of shops and of people the owner deals with are stored on qa (D-8, signed by the owner) like other transaction text, and in uploaded files until delete-all; point-in-time recovery keeps erased items for 35 days (threat model, Assets).
- One more prefix query on every read that applies choices; one full totals rebuild per label write.
- The report config must be applied once before the first enriched sync (`node scripts/mercadopago-report.mjs config`); sync stops until it is.
- A lost hashing key gives new keys to the same recipients, so old labels stop matching new rows; sync warns when it creates a key while enriched files exist.

## Revisit when
- Mercado Pago's report or search changes shape, or a payments field starts carrying contact details the cleaning does not catch.
- Labels need a screen of their own (list, rename, delete) or need to apply to other sources.
- The server ever needs to make keys itself (for example, an automatic upload).
