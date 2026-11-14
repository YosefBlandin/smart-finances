---
spec: mercadopago-enrichment
ticket: none
tier: M
status: locked-v1
---
# Mercado Pago enrichment: merchant names, category codes and name-once recipient labels: brief for smart-finances

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. Examples sit in these comments. -->

<!-- Fill every header line at handoff. Worktree and branch follow the convention in spec-profile.md Notes. Base is origin/ plus base_branch for smart-finances. -->
- Goal: Mercado Pago rows show who a payment went to or came from, get a category at import, and one label names and categorizes every row of a recipient.
- Implements: AC-1 to AC-10; D-6, D-7, D-8, D-10 to D-22
- Spec folder: /Users/v/projects/smart-finances/.claude/worktrees/mercadopago-sync/docs/specs/mercadopago-enrichment
- Refs: smart-finances at the sha in intent.md refs; run `node ~/.claude/skills/spec/scripts/drift.mjs <spec folder>` before the first task
- Worktree: /Users/v/projects/smart-finances/.claude/worktrees/mercadopago-sync (holds the uncommitted sync and probe work SF-1 commits)
- Branch: feature/mercadopago-sync · Base: origin/qa
- Brief version: the locked-vN named in the handoff prompt (the front matter says executing once DP4 passes); record it as pr-smart-finances.md@locked-vN in progress-smart-finances.json

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Contracts, all of it.
4. architecture.md: the Components section each task names, and States and exits.
5. The repo's CLAUDE.md or AGENTS.md if one exists, and docs/specs/spec-profile.md "Rules to honour".

## HUMAN needs
- <HUMAN: after the qa deploy, the owner applies the report config with the new default (node scripts/mercadopago-report.mjs config)> · Blocks: T-ENR-M1, release
- <HUMAN: the owner runs sync for a recent month, reads the column check line, then uploads the enriched months to qa> · Blocks: T-ENR-M1, release
- <HUMAN: the owner merges the draft PR into qa; on a revert, the owner runs POST /totals/rebuild and sets the report config back to the 15 live columns listed under Global constraints> · Blocks: release, rollback

## Global constraints
- D-4: Roles: the agent writes code, commits, pushes the feature branch and opens a draft PR into qa; the owner reviews, merges and promotes.
- D-6: Mercado Pago purchases that are still Uncategorized after enrichment go on the review list.
- D-7: Labeling a recipient sets the name and category on all its rows, past and future, and approves them.
- D-8: Names of people and shops from the payments service may be stored in the qa data store like transactions; delete-all removes them, and the 35-day backup window is accepted.
- D-10: Sync enriches each month on the owner's machine and appends three columns to the release report file; the uploaded file stays a release report the current upload path accepts.
- D-11: Recipient keys are made on the owner's machine with a keyed hash; the server never sees raw payments ids, account numbers or the hashing key.
- D-12: The hashing key is a random local file next to the reports, git-ignored, owner-only, created by sync on first use; losing it means relabeling.
- D-13: A label is stored once per recipient key and applied when rows are read; each label write starts a full totals rebuild.
- D-14: recipient_key becomes a shared transaction field, empty for other sources; the export gains one column.
- D-15: Mercado Pago expense categories come from the category code map, then merchant name rules, then the current rule, else Uncategorized; both lists live in a new module apart from the Notion rules.
- D-16: A month counts as fully synced only when its file has the enrichment columns; plain months are fetched again, a report made before the config change is requested anew, and the old file is set aside.
- D-17: If a payment search fails or passes 30 s, sync saves nothing for that month and reports it failed; the next run retries.
- D-18: A label's category beats a row's own review choice and the imported category; a label's name replaces the shown merchant and a label approves its rows.
- D-19: The report config default becomes the 15 live columns plus the payer name and payout account columns; the owner applies it once.
- D-20: ADR 0010 records the enrichment columns, recipient keys and read-time labels; the threat model gains the new assets and the owner's-machine boundary.
- D-21: The importer refuses a release report that still holds the payer name or payout account columns, and deletes that upload, so raw names and account numbers reach qa only through sync's cleaned file.
- D-22: The label control shows on every review and transactions row with a recipient key, so labeled rows stay reachable for relabeling.
- Logs, errors and reports carry internal ids, codes and counts only: no names, emails, IPs, file keys, cell values or response bodies (AC-10).
- Public repo: fixtures and tests use made-up names, ids and account numbers only (docs/specs/spec-profile.md, "Rules to honour"). Nothing from data/real enters a commit, a test or a log.
- Never run scripts/mercadopago-report.mjs or any call to the live Mercado Pago API; the token is the owner's (docs/specs/spec-profile.md, "Human-only actions"). Sync and probe tests use a fake api object, as scripts/mercadopago-sync.test.mjs does.
- Test commands (the profile's test.smart-finances is node --test {file}): API and contracts `node --test apps/api/test/<file>` or `node --test packages/contracts/test/<file>`; scripts `node --test scripts/<file>`; web `npm test --workspace @smart-finances/web -- <path>` plus `npm run lint --workspace @smart-finances/web`; infra `npm test --workspace @smart-finances/infra`. Full verify: `npm test; npm run build --workspace @smart-finances/infra`.
- The 15 live report columns: DATE SOURCE_ID DESCRIPTION NET_CREDIT_AMOUNT NET_DEBIT_AMOUNT GROSS_AMOUNT MP_FEE_AMOUNT TAXES_AMOUNT PAYMENT_METHOD TRANSACTION_APPROVAL_DATE BUSINESS_UNIT SUB_UNIT BALANCE_AMOUNT PAYMENT_METHOD_TYPE PURCHASE_ID. The D-19 columns: PAYER_NAME, PAYOUT_BANK_ACCOUNT_NUMBER.
- Payment fields: merchant name point_of_interaction.transaction_data.commerce.name, else description, else additional_info.items[0].title; category code point_of_interaction.transaction_data.commerce.mcc. Other party: collector.id in the search as payer, payer.id in the search as collector. Payouts are not in either search: their key comes from the report's PAYOUT_BANK_ACCOUNT_NUMBER; money received takes its name from PAYER_NAME.
- Report config reply (GET /v1/account/release_report/config): an object whose columns field is a list of {key: COLUMN_NAME}.
- gh and push access are set up on this machine (spec-profile.md preflight); if a push or gh call fails, stop.
- New ADR number: 0010. The docs test (apps/api/test/docs.test.mjs) needs an access-pattern row in ADR 0004 for every route.

## ALWAYS / ASK FIRST / NEVER
**ALWAYS**
- Write the test first and see it fail. One task, one commit.
- Put the test id in the test title.
- Record each verify command and its result in progress-smart-finances.json before the next task.

**ASK FIRST**
- Adding or upgrading a dependency that no decision or architecture.md Contracts names.
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
- Read, print or copy the values in .env.mercadopago or data/real, or run a live Mercado Pago call.
- Merge, mark a PR ready, promote, push a protected branch, write to cloud resources, read production or enter a password.
- Edit a decision. Record a deviation in progress-smart-finances.json and stop.

## Tasks

### SF-0 · Record the baselines
- Implements: none · After: none · Judgment: normal
- Files: none (no change)
- Tests first: none
- Do:
  - Confirm HEAD is origin/qa on feature/mercadopago-sync.
  - Run the full verify once, before any change.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` → each result recorded under baseline, red or green
- Done when: progress-smart-finances.json has brief, tool and model set, and baseline.tests, baseline.lint and baseline.typecheck each hold the command, pass or fail, and the counts (typecheck: the infra build)

### SF-1 · Commit the existing sync and probe work as it is
- Implements: D-10 · After: SF-0 · Judgment: normal
- Files: scripts/mercadopago-sync.mjs (new), scripts/mercadopago-sync.test.mjs (new), scripts/mercadopago-probe.mjs (new), scripts/mercadopago-probe.test.mjs (new), scripts/mercadopago-report.mjs, package.json, apps/api/README.md
- Tests first: none (existing tests)
- Do: commit these files unchanged as "Mercado Pago sync and probe scripts"; nothing under docs/specs.
- Verify: `node --test scripts/mercadopago-sync.test.mjs scripts/mercadopago-probe.test.mjs` → 17 pass
- Done when: the commit holds only these files

### SF-2 · recipient_key as a shared field, safe for stored rows
- Implements: D-14 · After: SF-1 · Judgment: high (cross-package contract)
- Files: smart-finances:packages/contracts/src/fields.mjs#FIELDS, smart-finances:packages/contracts/src/routes.mjs#ROUTES (Transaction), smart-finances:apps/api/src/store/query.mjs#fieldsOf, smart-finances:apps/api/src/store/imports.mjs#reconcile, smart-finances:apps/api/src/ingest/notion.mjs#parseNotionLog, smart-finances:apps/api/src/ingest/excel.mjs#parseBudgetWorkbook, smart-finances:apps/api/src/ingest/csv.mjs#parseGenericCsv, smart-finances:apps/api/src/ingest/mercadopago.mjs#parseReleaseReport, packages/contracts/test/contracts.test.mjs, the web fixtures typed as Transaction (apps/web/src/adapters/memory/data-api.ts, apps/web/src/screens/review/rollback.test.ts, apps/web/src/adapters/data-api.test.ts), their tests
- Tests first: T-ENR-1, T-ENR-2
- Do: follow architecture.md Contracts "Transaction field" and Components "Shared contract"; Transaction.recipient_key is a required z.string(), and the API always fills it (fieldsOf gives an empty string for old rows); the same-row check is sameRow in imports.mjs; every importer writes an empty string for now.
- Verify: `node --test packages/contracts/test/contracts.test.mjs apps/api/test/query.test.mjs apps/api/test/reconcile.test.mjs apps/api/test/export.test.mjs apps/api/test/schema.test.mjs` and `npm test --workspace @smart-finances/web -- src/adapters` → all pass, new tests included
- Done when: verify is green and the reviewer has no blocker

### SF-3 · Category code and merchant name rules
- Implements: AC-3, D-15 · After: SF-2 · Judgment: normal
- Files: apps/api/src/ingest/merchants.mjs#merchantCategory (new), apps/api/test/merchants.test.mjs (new)
- Tests first: T-ENR-3
- Do: two lists per architecture.md Components "Importer": four-digit category codes to CATEGORIES, and merchant name patterns (public shops and apps only) to CATEGORIES. Code first, then name. Unknown gives null. Pick well-known public codes and names yourself; the owner tunes them later (RK-3).
- Verify: `node --test apps/api/test/merchants.test.mjs` → all pass
- Done when: verify is green

### SF-4 · The importer reads the enrichment columns
- Implements: AC-2, AC-3, AC-4, AC-5, AC-9, D-6, D-15 · After: SF-3 · Judgment: normal
- Files: smart-finances:apps/api/src/ingest/mercadopago.mjs#parseReleaseReport, smart-finances:apps/api/src/ingest/mercadopago.mjs#categoryFor, smart-finances:apps/api/src/ingest/mercadopago.mjs#classify, apps/api/test/mercadopago.test.mjs, a made-up fixture under apps/api/test/fixtures
- Tests first: T-ENR-4, T-ENR-5, T-ENR-6
- Do: per architecture.md Components "Importer": merchant, recipient_key and category code per operation; category order; needs_review on Uncategorized expenses; SUB_UNIT optional; a file without SF_ columns parses exactly as before.
- Verify: `node --test apps/api/test/mercadopago.test.mjs` → all pass
- Done when: verify is green

### SF-5 · Refuse reports with raw columns
- Implements: AC-10, D-21 · After: SF-4 · Judgment: high (data protection)
- Files: smart-finances:apps/api/src/ingest/mercadopago.mjs#parseReleaseReport, smart-finances:apps/api/src/handlers/parser.mjs#IMPORTERS (the refusal path), apps/api/test/mercadopago.test.mjs, apps/api/test/parser.test.mjs
- Tests first: T-ENR-7
- Do: per architecture.md Components "Importer" (Refusal) and Contracts "Import failure code"; on qa the parser marks the import failed with private_columns and deletes the uploaded object; local ingest refuses with the same code. The message names the column only.
- Verify: `node --test apps/api/test/mercadopago.test.mjs apps/api/test/parser.test.mjs` → all pass
- Done when: verify is green and the reviewer has no blocker

### SF-6 · Labels in the store, applied on every read
- Implements: AC-6, AC-7, AC-8, D-13, D-18 · After: SF-2 · Judgment: high (read path and totals)
- Files: smart-finances:apps/api/src/store/keys.mjs#PREFIX, apps/api/src/store/keys.mjs#lblKey (new), apps/api/src/store/labels.mjs#putLabel (new), apps/api/src/store/labels.mjs#readLabels (new), smart-finances:apps/api/src/store/query.mjs#allRows, smart-finances:apps/api/src/store/query.mjs#shownRow, smart-finances:apps/api/src/store/query.mjs#reviewOf, smart-finances:apps/api/src/store/totals.mjs#monthRows, smart-finances:apps/api/src/store/totals.mjs#categoryOf, apps/api/src/store/review.mjs, apps/api/src/handlers/read.mjs, apps/api/test/labels.test.mjs (new), apps/api/test/erase.test.mjs
- Tests first: T-ENR-8, T-ENR-9, T-ENR-10
- Do: per architecture.md Components "Labels in the store" and Contracts "Label item" and "How a label applies"; putLabel writes with the existing eraseCheck in one transaction. Prefer folding the label into allRows' and monthRows' {row, choice} results; touch review.mjs and read.mjs callers only if needed.
- Verify: `node --test apps/api/test/labels.test.mjs apps/api/test/erase.test.mjs apps/api/test/query.test.mjs apps/api/test/totals.test.mjs apps/api/test/review.test.mjs` → all pass
- Done when: verify is green and the reviewer has no blocker

### SF-7 · The label route and the rollup failure destination
- Implements: AC-6, D-13 · After: SF-6 · Judgment: high (route and infra)
- Files: smart-finances:packages/contracts/src/routes.mjs#ROUTES, apps/api/src/handlers/write.mjs#putRecipientLabel (new), smart-finances:apps/api/src/handlers/write.mjs#ROUTE_HANDLERS, smart-finances:infra/lib/api-stack.ts#addRollup and the route list in infra/lib/api-stack.ts, apps/api/test/labels.test.mjs, apps/api/test/isolation.test.mjs (route count and SERVED_BY), packages/contracts/test/contracts.test.mjs, docs/specs/data-architecture/architecture.md section "HTTP routes" (one new row, which that test compares with ROUTES), infra/test/api-stack.test.ts
- Tests first: T-ENR-11, T-ENR-12
- Do: per architecture.md Contracts "PUT /recipients/{key}/label" and Components "Write route"; an invoke error after the commit still answers 200 and logs rebuild_not_started.
- Verify: `node --test apps/api/test/labels.test.mjs apps/api/test/http.test.mjs apps/api/test/isolation.test.mjs packages/contracts/test/contracts.test.mjs` and `npm test --workspace @smart-finances/infra` → all pass
- Done when: verify is green and the reviewer has no blocker

### SF-8 · Sync's pure parts: cleaning, keys, enrichment
- Implements: AC-1, AC-4, AC-9, AC-10, D-11, D-12 · After: SF-1 · Judgment: high (keyed hash, personal data)
- Files: scripts/mercadopago-sync.mjs#recipientKey (new), scripts/mercadopago-sync.mjs#loadHashKey (new), scripts/mercadopago-sync.mjs#enrichReport (new), scripts/mercadopago-sync.test.mjs
- Tests first: T-ENR-13, T-ENR-14, T-ENR-15
- Do: per architecture.md Contracts "Enriched report columns" and "Recipient key"; enrichReport takes the report text and the payments found and returns the enriched text without the raw columns. Uses node:crypto only. loadHashKey takes the folder as a parameter; tests use a temporary folder, never data/real.
- Verify: `node --test scripts/mercadopago-sync.test.mjs` → all pass
- Done when: verify is green and the reviewer has no blocker

### SF-9 · Sync's flow: config check, re-request, searches, failures
- Implements: AC-1, AC-10, D-16, D-17, D-19 · After: SF-8 · Judgment: normal
- Files: scripts/mercadopago-sync.mjs#searchPayments (new), scripts/mercadopago-sync.mjs#saveReport, scripts/mercadopago-sync.mjs#holdsFullMonth, scripts/mercadopago-sync.mjs#sync, scripts/mercadopago-sync.test.mjs
- Tests first: T-ENR-16, T-ENR-17, T-ENR-18
- Do: per architecture.md Components "Sync enrichment" and States and exits (config checked, month downloaded, month enriched); searchPayments is the probe's search with a 30 s timeout per request (an injectable timer or AbortSignal); the fake api in the tests gains config(); after the first enriched save, sync logs one column check line per D-19 column (present or not, filled count).
- Verify: `node --test scripts/mercadopago-sync.test.mjs` → all pass
- Done when: verify is green

### SF-10 · Report config default and the probe
- Implements: AC-10, D-19 · After: SF-9 · Judgment: normal
- Files: scripts/mercadopago-sync.mjs#REPORT_COLUMNS (new), scripts/mercadopago-report.mjs (config default), scripts/mercadopago-probe.mjs#probe, scripts/mercadopago-probe.test.mjs
- Tests first: T-ENR-19
- Do: REPORT_COLUMNS, exported from mercadopago-sync.mjs (mercadopago-report.mjs reads the token at import, so tests never import it), holds the 15 live columns plus the D-19 columns; the config command and sync's config check use it; the probe reuses searchPayments and drops the error-body excerpt.
- Verify: `node --test scripts/mercadopago-probe.test.mjs scripts/mercadopago-sync.test.mjs` → all pass
- Done when: verify is green

### SF-11 · Web data layer for labels
- Implements: AC-6, AC-10, D-13 · After: SF-7 · Judgment: normal
- Files: smart-finances:apps/web/src/ports/data-api.ts, smart-finances:apps/web/src/adapters/data-api.ts, smart-finances:apps/web/src/adapters/memory/data-api.ts#MemoryDataApi, apps/web/src/application/data/label.ts (new), apps/web/src/app/(app)/review/actions.ts#labelRecipient (new), smart-finances:apps/web/src/adapters/log.ts#assertSafeFields, their tests
- Tests first: T-ENR-20, T-ENR-21
- Do: per architecture.md Components "Web screens" (Logs, memory adapter) and Contracts "PUT /recipients/{key}/label"; labelRecipient goes through the same guarded money action as review choices.
- Verify: `npm test --workspace @smart-finances/web -- src/adapters src/application/data src/app` → all pass
- Done when: verify is green

### SF-12 · Label form on review and transactions rows
- Implements: AC-6, AC-7, D-7, D-22 · After: SF-11 · Judgment: normal
- Files: apps/web/src/screens/label/LabelForm.tsx (new), apps/web/src/screens/label/LabelForm.stories.tsx (new), smart-finances:apps/web/src/screens/review/View.tsx#ReviewView, apps/web/src/screens/review/Review.tsx, apps/web/src/screens/transactions/List/View.tsx, apps/web/src/screens/data/View.tsx (the STORED list), apps/web/messages/en.json, apps/web/messages/es.json, their tests
- Tests first: T-ENR-22, T-ENR-23
- Do: per architecture.md Components "Web screens": where it shows, the form, saving, accessibility and stories, copy (including the Your data line).
- Verify: `npm test --workspace @smart-finances/web -- src/screens src/i18n` and `npm run lint --workspace @smart-finances/web` → all pass
- Done when: verify is green

### SF-13 · ADR, threat model and docs
- Implements: D-20 · After: SF-12 · Judgment: normal
- Files: docs/adr/0010-recipient-labels.md (new), docs/adr/README.md, docs/adr/0004 access-pattern table, smart-finances:docs/threat-model.md, smart-finances:apps/api/README.md, apps/api/test/docs.test.mjs (its ADR, route and accepted lists)
- Tests first: T-ENR-24
- Do: per architecture.md Components "Docs"; the README's sync paragraph names the config step and its order (Cross-cutting, Release order).
- Verify: `node --test apps/api/test/docs.test.mjs` → all pass
- Done when: verify is green

### SF-14 · Full verify, conformance review, draft PR
- Implements: all · After: SF-13 · Judgment: normal
- Files: none beyond fixes inside earlier tasks' files
- Tests first: none
- Do: run the full verify; start a fresh read-only conformance reviewer (review-rubric.md, conformance); push feature/mercadopago-sync and open a draft PR into qa with the PR body below.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` → green, or the same reds as the baseline
- Done when: the draft PR is open and its body lists the HUMAN steps left

## Tests
| Test | Traces | Task | Level | Gate | Check |
|---|---|---|---|---|---|
| T-ENR-1 | D-14 | SF-2 | unit | G-merge | A row stored without recipient_key reads as an empty string through GET /transactions, GET /review and the web reply parse. |
| T-ENR-2 | D-14 | SF-2 | unit | G-merge | Re-importing an old file whose rows lack recipient_key changes no row. |
| T-ENR-3 | AC-3, D-15 | SF-3 | unit | G-merge | A known code maps to its category; a code miss falls to the name rule; neither gives null. |
| T-ENR-4 | AC-2, AC-3, AC-4 | SF-4 | unit | G-merge | An enriched report gives each operation its merchant, recipient key and category; money received shows the sender name. |
| T-ENR-5 | AC-5, D-6 | SF-4 | unit | G-merge | An expense still Uncategorized gets needs_review; a categorized one does not. |
| T-ENR-6 | AC-9 | SF-4 | unit | G-merge | A file without SF_ columns or SUB_UNIT parses as before; a cleaned value with spaces where ';' was imports. |
| T-ENR-7 | AC-10, D-21 | SF-5 | unit | G-merge | A header with PAYER_NAME or PAYOUT_BANK_ACCOUNT_NUMBER fails with private_columns, the upload object is deleted, and no row or log holds a value. |
| T-ENR-8 | AC-6, AC-7, D-18 | SF-6 | unit | G-merge | A label sets name, category and approval on stored and later-imported rows with its key, over an earlier row choice; totals follow. |
| T-ENR-9 | AC-8, D-8 | SF-6 | unit | G-merge | Delete-all removes label items, rows with merchant names and uploaded objects. |
| T-ENR-10 | D-13 | SF-6 | unit | G-merge | Two label writes back to back, with rebuilds finishing in either order, leave totals that match the reads. |
| T-ENR-11 | AC-6, D-13 | SF-7 | unit | G-merge | PUT label answers per Contracts: not_found, bad_request (Uncategorized too), conflict, 200 with one rebuild; an invoke error still answers 200. |
| T-ENR-12 | D-13 | SF-7 | unit | G-merge | The stack has the label route and the rollup's async failures go to RollupFailures. |
| T-ENR-13 | AC-9 | SF-8 | unit | G-merge | Cleaning turns ';', '"', line breaks and control characters into single spaces, trims and cuts to 80. |
| T-ENR-14 | D-11, D-12 | SF-8 | unit | G-merge | recipientKey is 32 hex characters, stable for one key, different across keys; the key file is created with mode 600. |
| T-ENR-15 | AC-1, AC-4, AC-10 | SF-8 | unit | G-merge | enrichReport appends the three columns, uses the payer name for money received, and the output holds no raw id, account number, email, phone or the raw columns. |
| T-ENR-16 | D-19 | SF-9 | unit | G-merge | Sync stops with the config instruction when the config lacks a D-19 column, and requests a new report once when a downloaded header lacks one. |
| T-ENR-17 | D-17, AC-10 | SF-9 | unit | G-merge | A failing or hanging search (30 s) saves nothing for the month, reports it failed, and the error line has month, code and status only. |
| T-ENR-18 | D-16 | SF-9 | unit | G-merge | A plain month is fetched again and set aside; an enriched month is not; a rejected file holds no raw columns. |
| T-ENR-19 | AC-10, D-19 | SF-10 | unit | G-merge | The config default has the 17 columns; probe error lines carry no response body. |
| T-ENR-20 | AC-6 | SF-11 | unit | G-merge | The memory adapter applies labels like the API; putLabel parses the reply. |
| T-ENR-21 | AC-10 | SF-11 | unit | G-merge | A failed label save logs no name; the logger refuses name, merchant and payer fields. |
| T-ENR-22 | AC-6, D-22 | SF-12 | unit | G-merge | The label control shows on review and transactions rows with a key, not on rows without; Uncategorized is not offered. |
| T-ENR-23 | AC-6, AC-7 | SF-12 | unit | G-merge | Saving removes the key's rows at once and brings them back on refusal; it shares the review in-flight guard; en and es keys match. |
| T-ENR-24 | D-20 | SF-13 | unit | G-merge | The docs test finds ADR 0010 accepted and the label route in ADR 0004. |
| T-ENR-M1 | AC-1, AC-4, D-19 | manual | manual | G-promote | Given the config applied, when the owner syncs a recent month, then the column check shows both columns present and filled, and qa shows names after the upload. |

## Stop and hand back when
<!-- Add ticket-specific stop points. At a stop: write the hand-back report and wait. -->
- A task would deviate from a decision. Record the deviation first.
- A value this brief needs is missing.
- Verify is still red after 2 fix rounds.
- A change is needed outside the task's Files.
- Credentials or production access are needed.
- The next step is a push to a protected branch, marking a PR ready, or a merge.
- The draft PR is open and its body is checked.
- A task needs a live Mercado Pago call, the values in .env.mercadopago or data/real, or real names in a fixture.

## Hand-back report
<!-- Build it from progress-smart-finances.json, not from memory: task rows (status, commit, evidence) live there; status.mjs prints only task counts. -->
- PR: link and state
- Tool and model: as recorded in progress
- Baseline → final: tests, lint, typecheck
- Tasks: done and blocked, with commit shas
- Deviations: each with the decision it touches and the proposal
- Surprises: what this brief did not predict, with evidence
- Next HUMAN step

## PR body
<!-- Use the repo's PR template (path in spec-profile.md Notes). Include: what changed per task id, test ids and results, deviations, and the HUMAN steps left. Attribution follows the tool's own settings; never hard-code a model. -->
