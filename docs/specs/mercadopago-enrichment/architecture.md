---
spec: mercadopago-enrichment
ticket: none
tier: M
status: executing
---
# Mercado Pago enrichment: merchant names, category codes and name-once recipient labels: architecture

<!-- Design by component. Cite code as <repo>:<path>#<Symbol>, never with line numbers; the drift script checks these refs. Add (new) after a file or symbol that a task creates. Cite ACs and decisions by id and never restate them. Executors read only the sections their tasks cite, so each section must stand on its own. Examples sit in these comments. -->

## Overview
Sync enriches each month on the owner's machine. It downloads the report, runs two payment searches, and writes three added columns per operation: merchant name, category code and recipient key (D-10, D-11). The importer, locally and on qa, maps those columns to the merchant, a category and a new recipient_key field (D-14, D-15). It refuses any report that still holds the raw payer name or payout account columns (D-21). A recipient label is one stored item per recipient key, applied wherever rows are read, like review choices (D-13, D-18). Writing a label starts a totals rebuild. The server never calls the payments service and never sees raw ids or the hashing key.

```
owner's machine: report (D-19 columns) + payment searches -> enriched release-YYYY-MM.csv (raw columns dropped) -> ingest-local | manual qa upload
qa: upload -> parser (refuses raw columns; merchant, category, recipient_key) -> TXN rows
    PUT label -> LBL item -> rollup rebuild ; reads join TXN + OVR + LBL
```

## Components

### Sync enrichment (AC-1, AC-4, AC-9, AC-10; D-10, D-11, D-12, D-16, D-17)
- Where: scripts/mercadopago-sync.mjs#enrichReport (new), scripts/mercadopago-sync.mjs#searchPayments (new), scripts/mercadopago-sync.mjs#recipientKey (new), scripts/mercadopago-sync.mjs#loadHashKey (new); scripts/mercadopago-sync.mjs#saveReport (new) and scripts/mercadopago-sync.mjs#holdsFullMonth (new) change. The sync and probe modules are uncommitted at the pin (F-21); the PR's first task commits them as they are, so every later task diffs against them.
- Before planning, sync reads the report config. If it lacks the payer name or payout account column, sync stops and tells the owner to run the config command (D-19). Nothing is requested or saved.
- After a report downloads: if its header lacks either D-19 column (a report made before the config change), sync discards it and requests a new report for that month once (D-16).
- Then sync searches the month's payments as payer and as collector (the probe's search, moved here), joins them to operations by payment id equal to SOURCE_ID, and appends the enrichment columns (Contracts, "Enriched report columns") to every row of that operation.
  - Merchant name: the commerce name, else the description, else the first item title, for payments; the report's payer name for money received.
  - Recipient key: the HMAC (Contracts, "Recipient key") of the other party's payments user id, or of the payout bank account number for payouts.
  - Values are cleaned (Contracts) before writing. The payer name and payout account columns are dropped from the saved file. The result must still parse as the same month before it is saved.
- Each search request has a 30 s timeout; a timeout counts as a failed search (D-17). A failed search saves nothing for that month.
- A month counts as fully synced only when its file has the enrichment columns, so plain files from before are fetched again and set aside in replaced/ (D-16).
- A file that fails its checks goes to rejected/ with the payer name and payout account columns removed (split on the header's ';'), never as the raw download.
- Error lines in sync and in the probe carry the month, an error code and the HTTP status only, never a parser message, a response body or a cell value (research correction 1, AC-10). The probe's error-body excerpt goes.
- Stays the same: report request and waiting, month checks, the token rules, the probe's counts (it reuses searchPayments).

### Report config (D-19)
- Where: scripts/mercadopago-report.mjs default columns (exists at the pin).
- What: the default list becomes the 15 live columns plus PAYER_NAME and PAYOUT_BANK_ACCOUNT_NUMBER (research correction 2, F-2). The owner applies it once, before the first enriched sync; applying and reverting it are HUMAN steps (Cross-cutting).
- A HUMAN check right after applying: one sync run of a recent month. Sync prints, per D-19 column, only whether it is present and how many rows fill it. If a column is missing, execution stops (Risks, RK-7).

### Importer (AC-2, AC-3, AC-4, AC-5, AC-10; D-6, D-14, D-15, D-21)
- Where: smart-finances:apps/api/src/ingest/mercadopago.mjs#parseReleaseReport, smart-finances:apps/api/src/ingest/mercadopago.mjs#categoryFor, smart-finances:apps/api/src/ingest/mercadopago.mjs#classify; apps/api/src/ingest/merchants.mjs#merchantCategory (new); smart-finances:apps/api/src/handlers/parser.mjs#IMPORTERS for the refusal path.
- Refusal (D-21): a header that holds PAYER_NAME or PAYOUT_BANK_ACCOUNT_NUMBER fails the whole file with code private_columns, before any row is read. On qa the parser marks the import failed with that code and deletes the uploaded object at once (the only failed import whose object is deleted). Local ingest refuses it the same way and names the file.
- Per operation: merchant is the first non-empty SF_MERCHANT of its rows, recipient_key the first non-empty SF_RECIPIENT, and the category code the first non-empty SF_CATEGORY_CODE.
- Category order for expenses: category code map, then merchant name rules, then the existing Mercado Libre rule, else Uncategorized (D-15). Interest, refunds and transfers keep their current categories. An expense that ends Uncategorized gets needs_review (D-6).
- Missing enrichment columns behave exactly as today. SUB_UNIT becomes optional (F-2).
- merchants.mjs holds two lists: category codes to categories, and merchant name patterns to categories. They are separate from the Notion label rules (F-8). Patterns name public shops and apps only, never people.
- Other importers write recipient_key as an empty string: smart-finances:apps/api/src/ingest/notion.mjs#parseNotionLog, smart-finances:apps/api/src/ingest/excel.mjs#parseBudgetWorkbook, smart-finances:apps/api/src/ingest/csv.mjs#parseGenericCsv.

### Shared contract (D-14)
- Where: smart-finances:packages/contracts/src/fields.mjs#FIELDS, smart-finances:packages/contracts/src/routes.mjs#ROUTES, smart-finances:apps/api/src/store/query.mjs#fieldsOf, smart-finances:apps/api/src/store/imports.mjs#reconcile.
- What: FIELDS gains recipient_key after merchant; the Transaction schema follows (F-6). Rows stored before the change have no such attribute: fieldsOf returns an empty string for it, and reconcile's same-row check treats a missing value as empty, so re-importing an old file changes nothing. A new route, PUT /recipients/{key}/label (Contracts).

### Labels in the store (AC-6, AC-7, AC-8; D-13, D-18)
- Where: smart-finances:apps/api/src/store/keys.mjs#PREFIX, apps/api/src/store/keys.mjs#lblKey (new), apps/api/src/store/labels.mjs#putLabel (new), apps/api/src/store/labels.mjs#readLabels (new); smart-finances:apps/api/src/store/query.mjs#shownRow, smart-finances:apps/api/src/store/query.mjs#reviewOf, smart-finances:apps/api/src/store/query.mjs#allRows, smart-finances:apps/api/src/store/totals.mjs#monthRows, smart-finances:apps/api/src/store/totals.mjs#categoryOf.
- What: a label is one LBL item per recipient key under the person's partition (Contracts). Every read that joins choices also reads the person's labels (one small query) and applies them by the rule in D-18. Totals use the same rule, so a rebuild after a label write moves the money to the label's category.
- Overlapping rebuilds: recomputeMonth already writes a month only when its start time is later than the stored one (smart-finances:apps/api/src/store/totals.mjs#recomputeMonth). A rebuild requested after a label commit starts after it, so the last label always wins. A test writes two labels back to back and checks the totals match the reads.
- Delete-all already covers the person's partition (F-14), so labels need no erase change; a test proves it.

### Write route (AC-6; D-13)
- Where: apps/api/src/handlers/write.mjs#putRecipientLabel (new), registered in smart-finances:apps/api/src/handlers/write.mjs#ROUTE_HANDLERS; route added in smart-finances:infra/lib/api-stack.ts.
- What: refuses during an erase, checks the key shape and body, writes the label with the erase check in one transaction, then asks the rollup for a full rebuild (the existing months 'all' invoke used by POST /totals/rebuild). It counts nothing. One write and one invoke, so the person limit and the 10 s timeout are not at risk (F-13).
- Rollup async failures: the rollup gets an async-invoke on-failure destination, the existing RollupFailures queue, so a failed rebuild raises the existing alarm (smart-finances:infra/lib/api-stack.ts#addRollup). An infra test checks the destination.

### Web screens (AC-6, AC-7; D-7, D-18, D-22)
- Where: smart-finances:apps/web/src/screens/review/View.tsx#ReviewView, smart-finances:apps/web/src/screens/review/Review.tsx, the transactions screen under smart-finances:apps/web/src/screens/transactions, apps/web/src/screens/label/LabelForm.tsx (new), apps/web/src/app/(app)/review/actions.ts#labelRecipient (new), apps/web/src/application/data/label.ts (new), the DataApi port smart-finances:apps/web/src/ports/data-api.ts, smart-finances:apps/web/src/adapters/memory/data-api.ts#MemoryDataApi, smart-finances:apps/web/src/adapters/data-api.ts.
- Where the control shows (D-22): "Label this recipient" on every review row and every transactions row that has a recipient key. It is the only way to reach a labeled row, whose label approves it off the review list; labeling again replaces the label. Rows without a key look as today.
- The form: a name field (prefilled with the shown merchant, 1 to 80 characters) and a category select without Uncategorized.
- Saving: the save button is disabled while saving. Under the web-ui spec's optimistic-update rule (docs/specs/web-ui/decisions.md, decision 131), a label counts as an approval: on the review screen, rows with that key leave the list at once and come back if the save is refused. The label save shares the review choices' in-flight guard (the mutation key Review.tsx counts), so neither refetch undoes the other. After success it refreshes review, totals and transactions, and refreshes totals once more after 5 s because the rebuild runs on its own (D-13).
- Accessibility and stories: field errors and the form message follow docs/specs/web-ui/architecture.md, section "Accessibility"; the select comes from React Aria (docs/specs/web-ui/decisions.md, decision 141); Storybook stories in both languages and themes (same file, decision 129) for idle, invalid name, saving and refused.
- Copy in en and es, kept equal by the existing key parity test: the label control, its errors, and the Your data page line that lists what is stored and deleted (F-14).
- Logs: labelRecipient logs the outcome and the key's first 8 characters only, never the name; the web logger adds name, merchant and payer to its refused fields (F-19), with a test that a failed save logs no name.
- The memory adapter applies labels the way the real API does.

### Docs
- docs/adr/0010-recipient-labels.md (new): enrichment columns, recipient keys, labels at read time, the parser refusal (D-20).
- smart-finances:docs/threat-model.md: new assets (third-party names, recipient keys, labels, the local hashing key) and a boundary for the owner's machine and the payments service (F-16, D-20).
- smart-finances:apps/api/README.md and the route list the docs test checks; the README's sync paragraph names the config step and its order.

## Contracts

### Enriched report columns
- Three columns appended to the release report header, in this order: SF_MERCHANT, SF_CATEGORY_CODE, SF_RECIPIENT. Every data row of an operation carries the same values; the opening and totals rows carry empty cells.
- SF_MERCHANT: at most 80 characters after cleaning, or empty.
- SF_CATEGORY_CODE: exactly four digits, or empty.
- SF_RECIPIENT: 32 lowercase hex characters, or empty.
- Cleaning, applied to every value before writing: each ';', '"', carriage return, line feed and other control character becomes a space; runs of spaces collapse to one; the value is trimmed and cut to the limit (AC-9).
- Never written to any saved file (enriched, replaced/ or rejected/): payer email, phone, ID number, raw payments user ids, raw account numbers (AC-10). Saved files never hold the PAYER_NAME or PAYOUT_BANK_ACCOUNT_NUMBER columns.

### Recipient key
- HMAC-SHA256 with the local hashing key over "mp:<payments user id>" or "bank:<payout account number>", as lowercase hex, first 32 characters.
- The hashing key: 32 random bytes as hex in data/real/mercadopago/.hashing-key, created by sync on first use with file mode 600, git-ignored by the data rule. Sync warns when it creates a new key while enriched files already exist, because new keys will not match old labels (RK-2).

### Transaction field
- recipient_key: string, empty when the source has none or the stored row predates the field. Added to FIELDS after merchant, so export gains one column. A test reads a row stored without it through GET /transactions, GET /review and the web reply parse.

### Label item
- Key: pk U#<sub>, sk LBL#<recipient_key>. Fields: recipient_key, name (1 to 80 characters, trimmed), category (one of CATEGORIES except Uncategorized), updated_at (ISO time).
- Not month-ranged; read with a prefix query. The rollup stream ignores it (F-11), so the route asks for a rebuild.

### PUT /recipients/{key}/label
- Path key: ^[0-9a-f]{32}$, else not_found.
- Request: { name: string 1 to 80 after trim, category: one of CATEGORIES except Uncategorized }.
- Reply 200: { label: { recipient_key, name, category, updated_at } }.
- Errors: not_found (bad key shape), bad_request (body), conflict (erase window), as other write routes.
- The web DataApi port gains putLabel with the same input and output.

### Import failure code
- private_columns: the report header holds PAYER_NAME or PAYOUT_BANK_ACCOUNT_NUMBER. The message names the column and says to save the month with sync; it never holds a value. The web shows it like other failed imports; no new web text.

### How a label applies (D-18)
- Shown merchant: the label's name, else the row's merchant.
- Category: the label's category, else the row's review choice category, else the row's category. Totals use the same order.
- Approved: true when a label exists or the choice says approved.

## Alternatives

### Fork: when a label reaches the rows (D-13)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. One stored label, joined when rows are read | one more small query per read; totals need a rebuild per label write | label item, read join, route triggers rebuild | chosen |
| B. Write a review choice on every matching row | hundreds of writes per label; future rows need the parser to write choices too | bulk route in batches of 100, parser change | rejected: slow and touches the importer's write path |
| C. Write the label into the rows at import | past rows need a re-import; local ingest needs the labels too | parser reads labels | rejected: AC-6 needs past rows at once |

### Fork: where recipient keys are made (D-11)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. On the owner's machine, during sync | key lives only locally; losing it means relabeling | none on the server | chosen |
| B. On the server, in the parser | raw ids reach the uploaded file and bucket; new secret grant (F-18) | Secrets Manager, parser grant | rejected: more data and access on the server |

### Fork: label versus a row's earlier choice (D-18)
| Option | Cost | Wiring | Verdict |
|---|---|---|---|
| A. The label's category wins | a single row of a labeled recipient cannot differ | read rule only | chosen: AC-6 says every row |
| B. The newer of label and choice wins | needs choice times on every read; harder to explain | read rule compares times | rejected: no screen reaches labeled rows per row |
| C. The choice wins | labeling leaves reviewed rows unchanged | read rule only | rejected: breaks AC-6 |

## States and exits
| State | Entered when | Exits when | On failure or timeout |
|---|---|---|---|
| config checked | sync starts | the config has both D-19 columns | missing column: sync stops with the config instruction, nothing saved |
| month downloaded | the report file arrives | its header has both D-19 columns and the searches finish | old header: one new report is requested; a search error or a 30 s timeout: the month is reported failed, nothing saved, the next run retries (D-17) |
| month enriched | both searches joined | the enriched file parses as the month and is saved | a parse failure: the file goes to rejected/ without the raw columns, the old file stays |
| upload refused | a report with raw columns reaches the parser | the import is marked failed with private_columns and the object is deleted | the delete fails: the import is still failed; the object stays until delete-all, and the parser logs the import id |
| label written | the route's transaction succeeds | the rollup rebuild finishes | rebuild fails after retries: the RollupFailures queue and alarm fire; POST /totals/rebuild recovers; reads already show the label |
| invoke refused | the label is committed but the rebuild invoke errors | the route answers 200 and logs rebuild_not_started | the next label write, choice or POST /totals/rebuild recomputes |

## Cross-cutting
- Security and permissions: the new route is a person-scoped write like the review route; keys are built only in keys.mjs; no new grant beyond the existing rollup invoke and one queue destination.
- Personal data and logs: names of shops and of people the owner deals with are stored on qa (D-8). Emails, phones, ID numbers and raw ids are never stored (AC-10); the parser refusal keeps raw columns out even from hand-downloaded reports (D-21). Sync, the probe, the parser, the route and the web action log ids, counts and codes only. The hashing key never leaves the owner's machine.
- Performance and cost: two to six search calls per month during sync; one extra small query per read; one full rebuild per label write.
- Deploy and infrastructure: one route and one async-invoke destination in the API stack; no new table, index or secret.
- Observability: the route logs one line with the outcome; the rollup's failures reach the existing alarm.
- Old clients and old data: older plain report files still import unchanged; stored rows without recipient_key read as empty. The web reads the new field after the API deploys; until then it ignores it.
- Release order: one PR; CI deploys the API stacks before the web app (appetite). HUMAN, in order, after the deploy: apply the report config (D-19), run the column check (Report config), then run sync and upload the enriched months.
- Rollback: revert the PR; then, HUMAN, run POST /totals/rebuild so totals drop the label categories, and revert the report config to the 15 columns. Labels left in the table are ignored by the old code. Names stay in rows and in uploaded objects until the owner deletes everything, which is the only full removal (D-8, door 1-way).

## Risks
| RK | Risk | Likelihood | Impact | Mitigation or acceptance | Owner |
|---|---|---|---|---|---|
| RK-1 | A merchant name carries text meant to trick a later assistant feature. | low | medium | Already treated as untrusted text (F-16); rendered as text only; a review screen test with markup in a name. | engineering |
| RK-2 | The local hashing key is lost, so new rows get new keys and old labels stop matching. | low | medium | Sync warns when it creates a key while enriched files exist; the owner backs the file up. Accepted: relabeling fixes it. | owner |
| RK-3 | A category code or merchant rule picks the wrong category. | medium | low | A per-row choice or a label overrides it (D-18); unit tests for each mapping. | owner |
| RK-4 | The payments search changes shape, fails or hangs, so a month is never enriched. | low | medium | 30 s timeout; the month is reported failed and nothing is saved (D-17); a sync test with a failing and a hanging search. | engineering |
| RK-5 | One recipient key covers payments the owner would categorize differently. | medium | low | Accepted in D-7 and D-18: the label decides every row; relabeling from any row with the key is the fix (D-22). | owner |
| RK-6 | Uncategorized purchases make the review list long. | high | low | Accepted in D-6; labels and rules shrink it. | owner |
| RK-7 | The release report rejects or leaves empty the payer name or payout account column, so money received gets no sender name and payouts get no key. | low | medium | The column check after the config step (Report config) stops execution before release; the rest of the work still ships if the owner accepts a new D-n. | owner |

## Facts
<!-- The research facts design uses, cited by id from research.md and later sections. Line-level evidence for each sits in research.md. -->
| F | Area | Fact | Evidence |
|---|---|---|---|
| F-1 | import | The release report parser accepts extra header columns and maps cells by header name. It splits on ';' with no escaping and refuses the whole file if any line holds a double quote. Six columns are required. | smart-finances:apps/api/src/ingest/mercadopago.mjs#parseRows; smart-finances:apps/api/src/ingest/mercadopago.mjs#REQUIRED |
| F-2 | import | SUB_UNIT is required in practice: the business-unit lookup trims SUB_UNIT on rows with no BUSINESS_UNIT and throws if the column is missing. | smart-finances:apps/api/src/ingest/mercadopago.mjs#parseReleaseReport |
| F-3 | import | Mercado Pago rows always get an empty merchant and a category of Interest, Refunds, Shopping (Mercado Libre unit) or Uncategorized; the shared keyword rules are not applied. | smart-finances:apps/api/src/ingest/mercadopago.mjs#categoryFor |
| F-4 | import | Only payouts and inflows get needs_review. Expenses are never flagged, so uncategorized expenses never reach the review list. | smart-finances:apps/api/src/ingest/mercadopago.mjs#classify; smart-finances:apps/api/src/store/query.mjs#REVIEW_FLAGS |
| F-5 | import | A row id comes from SOURCE_ID and month. Added columns change only the file part of source_ref, import_batch and the server's content hash, so an enriched re-upload is a new import with the same row ids. | smart-finances:apps/api/src/ingest/schema.mjs#hashId; smart-finances:apps/api/src/ingest/schema.mjs#batchId; smart-finances:apps/api/src/handlers/parser.mjs#contentHash |
| F-6 | import | The shared schema has 14 fields, merchant among them, and no slot for a recipient key or a category code. The contract throws at load if the field list and the Transaction schema differ. | smart-finances:packages/contracts/src/fields.mjs#FIELDS |
| F-7 | import | Reconcile stores each whole parsed transaction object, extra properties included, but reads, export and change detection use the field list only. Rows missing from a new file are removed; review choices are untouched. | smart-finances:apps/api/src/store/imports.mjs#reconcile; smart-finances:apps/api/src/store/query.mjs#fieldsOf |
| F-8 | import | CATEGORIES has 17 rule categories, 7 importer-set ones and Uncategorized last. The keyword RULES are regexes tuned for short Notion labels, many anchored; the first match wins. | smart-finances:packages/contracts/src/categories.mjs#CATEGORIES; smart-finances:apps/api/src/ingest/categories.mjs#RULES |
| F-9 | import | A Mercado Pago upload must be a .csv name of at most 5 MiB, checked by the contract and by the presigned form. | smart-finances:packages/contracts/src/sources.mjs#checkImportRequest |
| F-10 | labels | A review choice (category, approved) is stored per row in its own item, only for Mercado Pago rows, and survives re-imports. No route applies one choice to many rows. | smart-finances:apps/api/src/store/review.mjs#putReview; smart-finances:apps/api/src/handlers/write.mjs#ROUTE_HANDLERS |
| F-11 | labels | Totals use the choice's category over the row's. The rollup reacts only to transaction and choice items; a write of any other kind recomputes nothing. | smart-finances:apps/api/src/store/totals.mjs#categoryOf; smart-finances:infra/lib/api-stack.ts#addRollup |
| F-12 | labels | Month-ranged reads accept only four item prefixes. There is no secondary index; every read queries the person's partition. | smart-finances:apps/api/src/store/keys.mjs#monthRange |
| F-13 | labels | The web app allows 120 data requests per person per minute; the read and write functions time out at 10 s; one store transaction holds at most 100 items. | smart-finances:apps/web/src/domain/limits.ts#personLimit |
| F-14 | labels | Delete-all removes every item under the person's partition and every upload under their prefix. Export writes the field list only, with choices applied. | smart-finances:apps/api/src/store/erase.mjs#eraseAll; smart-finances:apps/api/src/handlers/read.mjs#exportCsv |
| F-15 | labels | The review screen shows merchant (or "no name"), description_raw and category, with a category select and Approve only on Mercado Pago rows. The memory data adapter writes the category onto the row, unlike the real API. | smart-finances:apps/web/src/screens/review/View.tsx#ReviewView; smart-finances:apps/web/src/adapters/memory/data-api.ts#MemoryDataApi |
| F-16 | privacy | The threat model has no asset for third-party names, merchant names or recipient keys, and no boundary for the owner's machine or the payments API. It already treats a merchant name as untrusted text. | smart-finances:docs/threat-model.md |
| F-17 | privacy | The data table uses the AWS-owned key and point-in-time recovery in every stage, so erased items stay restorable for 35 days. Raw uploads stay in the bucket until delete-all. | smart-finances:infra/lib/data-stack.ts; smart-finances:docs/adr/0004-access-patterns.md |
| F-18 | privacy | Server secrets live in Secrets Manager with only their ARN in a parameter. The parser function has no secret or parameter grant today. | smart-finances:infra/lib/web-stack.ts#hmacSecret; smart-finances:infra/lib/api-stack.ts |
| F-19 | privacy | The web logger refuses fields named password, code, secret, token, email or ip; name, merchant and payer are not refused. The API has no logger and logs hand-built JSON lines. | smart-finances:apps/web/src/adapters/log.ts#assertSafeFields |
| F-20 | privacy | Row ids use an unkeyed SHA-256; no keyed hash exists in the API. Git ignores .env files. | smart-finances:apps/api/src/ingest/schema.mjs#hashId; smart-finances:.gitignore |
| F-21 | sync | Sync saves the downloaded bytes unchanged as release-YYYY-MM.csv after checking the month. The probe searches as payer and as collector and joins by payment id equal to SOURCE_ID. | scripts/mercadopago-sync.mjs (new); scripts/mercadopago-probe.mjs (new) |
| - | callers | Release report parser: parser function, ingest-local, sync, probe, API tests. Review choices: web review page, shell count, overview list, review JSON route, memory adapter, api-call script. Erase and export: Your data page and account deletion. The old Angular app has no link to the data store. | smart-finances:apps/api/src/handlers/parser.mjs#IMPORTERS; smart-finances:README.md |
