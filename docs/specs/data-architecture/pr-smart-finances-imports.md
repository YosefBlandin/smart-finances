---
spec: data-architecture
ticket: none
tier: L
status: locked-v3
---
# Data architecture: model, store, access patterns, ingestion and auth: brief for smart-finances (PR 2 of 3, imports)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. -->

- Goal: the owner can upload a file, see its import record, re-upload or correct it without double counting, and undo or repair a period.
- Implements: AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-20, D-9, D-15, D-16, D-17, D-23, D-25, D-28, D-32
- Spec folder: /Users/v/projects/smart-finances/.claude/worktrees/data-architecture/docs/specs/data-architecture
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git -C /Users/v/projects/smart-finances fetch origin qa`, then `node ~/.claude/skills/spec/scripts/drift.mjs <spec folder> --strict` (exit 0; NEW lines are expected)
- Worktree: /Users/v/projects/smart-finances/.claude/worktrees/data-imports
- Branch: feature/data-imports · Base: origin/qa, after PR 1 (feature/data-foundation) is merged into qa
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances-imports.md@locked-vN in progress-smart-finances-imports.json
- Order: PR 2 of 3. PR 3 starts after this PR is merged.
- From PR 1 (read the code after SF-20): apps/api/src/store/keys.mjs (every key, including IMP, PER, ERASED and the uploads/<sub>/<importId> object key), memory.mjs and repo.mjs (get, put, remove, query, transact with `if` conditions and ConditionFailed; presignPost, getObject, deleteObject, listKeys, deleteObjects, invokeAsync), apps/api/src/handlers/http.mjs (HttpError, personOf, reply, fail), infra/lib/function.ts#makeFunction, ApiStack's public JWT authorizer, and infra/test/api-stack.test.ts. All SDK packages are already installed.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "API stack", "Handlers", "Importers"; Contracts "Identity", "Table items", "Import record", "S3 keys", "HTTP routes" (the imports, undo and repair rows and the notes below the table), "Parser input", "Rollup" (only its last two bullets: the erase check); "States and exits", all of it.
4. CLAUDE.md or AGENTS.md in the worktree, if present.
5. test-matrix.md rows whose task is SF-21 to SF-31.
6. progress-smart-finances-imports.json: baseline, then per task status, commit, evidence (command and result), review; deviations and surprises as lists.

## HUMAN needs
- PR 1 merged into qa before SF-20.

## Global constraints
- D-4: Roles: the agent writes code, commits, pushes feature branches and opens PRs into qa; the user reviews, merges and promotes. Source: how PRs 1 and 2 ran, and the profile's human-only list (default).
- D-3: Agent access: local tests, builds, CDK synth and the local import, plus read-only AWS calls with the personal profile. No AWS writes; the user runs anything that changes the account.
- D-6: Every stored item, uploaded file and review choice is filed under the signed-in person's identity, even with one user.
- D-9: A new file for the same source and period replaces the earlier rows from that source and period; undo restores the previous file's rows.
- D-15: Uploads: the client names the source; the API returns a presigned POST form for one exact key with a size range, valid 15 minutes; an S3 event through EventBridge runs the parser.
- D-16: Periods: payments report and budget workbook files cover one calendar month; a notes log or generic CSV covers the whole file. One import at a time per source and period, by a conditional lock.
- D-17: Undo applies only to a period's active import: it moves the period pointer to the previous file, or to none, and reconciles; a repeat undo gets conflict. Raw uploads are kept until delete-all.
- D-23: A generic CSV importer reads the synthetic data shape, so evals and the demo use the same upload path.
- D-25: The workbook reader caps entry count and total inflated size and inflates only the parts it reads.
- D-28: An import commits by moving its period pointer before writing rows, then reconciles: the period's stored rows are made equal to the active file's rows. Retries, re-uploads and a repair request re-run the reconcile.
- D-32: Reconcile of a one-month period reads only that month's transaction range, filtered by source; a log period reads every transaction, filtered by source and period. The parser fails a one-month file that has a row dated outside its month. A secondary index, keyset paging and async delete-all and export stay out until their scale triggers in architecture.md Risks are reached.
- D-30: After delete-all, imports, undo, repair and totals are refused for a quiet window of 65 minutes, so no late background work can bring erased data back.
- Values:
  - Sources and periods: mercadopago and excel use the importer's check.month (yyyy-mm); notion and csv use the period log.
  - file_name rules: mercadopago and csv end in .csv; notion ends in .md; excel matches parseBudgetWorkbook's own pattern /([A-Z]{3})_(\d{4})\.xlsx$/i with the three letters a month (JAN to DEC, any case). Anything else is bad_request.
  - Size caps: excel 20 MiB, the others 5 MiB; over the cap is too_large. Form: one exact key, content-length-range 1 to the cap, expires in 15 minutes.
  - Lock: lock_until = now + 10 minutes. A file with more than 2,000 unreadable rows fails as a whole.
  - Workbook caps (D-25): at most 500 zip entries and at most 100 MiB inflated in total; the existing 20 MiB file and 50 MiB per-part caps stay.
  - Functions: api-read and api-write 256 MB, 10 s; parser 1024 MB, 5 minutes, async retries 2, no on-failure destination.
  - importId is a ULID from apps/api/src/store/ulid.mjs (new, monotonic, no dependency).
  - Timestamps are ISO 8601 UTC strings (created_at, expires_at, finished_at, lock_until); comparisons use them as strings.
  - Lock re-entry: the record that holds lock_import may re-enter (a retry or a duplicate event of the same import, which redoes the same idempotent step). "Another run" means another import record.
  - GET /imports pages hold 50 items. An expired import shows status expired with error { code: file_not_arrived, message }, computed on read.
  - Generic CSV rows (D-23): kind expense when the amount is negative, else income; category Uncategorized; flags empty; merchant and country empty; description_raw is the description as given; source_ref <file>#row <n> (data row number, header excluded); id = hashId('csv', date, description, amount, currency, account), so exact duplicate rows share an id; the importer keeps the first and records each later one as an info issue (not a skipped row).
  - AC-20 baseline: copy data/real/clean to data/real/clean-baseline (git-ignored, stays under data/real per the local data rule). npm run ingest:local writes through the data/real symlink into the main checkout's data/real; that is expected and allowed (D-3).
  - Env for functions: TABLE_NAME, BUCKET_NAME, PARSER_FUNCTION (api-write; the parser's function name). api-write gets invoke rights on the parser only in this PR; PR 3 adds the rollup.
  - Import records are the person's own data: they store the importer's check object and s3_key as Contracts "Import record" says. The log rule below covers logs only.
  - ingest:local exits 1 when a reconciliation check fails; record its exit code at SF-20 and expect the same code later.
- Rules: README.md "Layout" (only data/synthetic is committed); .gitignore block "Real financial data stays local".
- Public repo: tests and fixtures use synthetic data only. No personal data, names, account ids or real figures anywhere committed.
- Logs carry ids, counts and reasons only: no descriptions, amounts, file contents or object keys.

## ALWAYS / ASK FIRST / NEVER
**ALWAYS**
- Symlink data/real in the worktree to /Users/v/projects/smart-finances/data/real (spec-profile.md Notes).
- Build every key through apps/api/src/store/keys.mjs; take the person only from personOf.
- Write the test first and see it fail. One task, one commit. Put the test id in the test title.
- Make every lock and pointer write conditional on lock_import being this record.
- Record each verify command and its result in progress-smart-finances-imports.json before the next task.

**ASK FIRST**
- Adding or upgrading any dependency.
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
- Run cdk deploy or any AWS write. cdk synth without credentials only.
- Merge, mark a PR ready, promote, push a protected branch, write to cloud resources, read production or enter a password.
- Commit anything from data/real, or a test fixture derived from it.
- Edit a decision. Record a deviation in progress-smart-finances-imports.json and stop.

## Tasks

### SF-20 · Record the baselines
- Implements: none · After: none · Judgment: normal
- Files: none (no change)
- Tests first: none
- Do:
  - Create the worktree and branch from origin/qa (with PR 1 merged); add the data/real symlink.
  - Run npm ci, the Verify line below, and `npm run ingest:local`; then `cp -R data/real/clean data/real/clean-baseline` as the AC-20 baseline.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` → results recorded under baseline
- Done when: the baseline is recorded and the worktree is clean

### SF-21 · Period of a file
- Implements: AC-4, D-16 · After: SF-20 · Judgment: high
- Files: smart-finances:apps/api/src/ingest/period.mjs#periodOf (new), apps/api/test/period.test.mjs (new)
- Tests first: T-IMP-1
- Do:
  - periodOf(source, result) returns the period per the Values. For a payments report whose check.rowsOutsideMonth is above 0, it also returns one skipped entry { where: file, reason } naming how many rows fell outside the month.
  - One test per source; an unknown source throws.
- Verify: `node --test apps/api/test/period.test.mjs` → T-IMP-1 passes
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-22 · Generic CSV importer
- Implements: AC-4, AC-5, D-23 · After: SF-20 · Judgment: normal
- Files: smart-finances:apps/api/src/ingest/csv.mjs#parseGenericCsv (new), apps/api/test/csv.test.mjs (new)
- Tests first: T-IMP-2
- Do:
  - Read data/synthetic/transactions.csv's header (date, description, amount, currency, account) and both date shapes in it (ISO, and DD/MM/YYYY day-first); map fields per the Values; return { transactions, issues } with rows in the schema of smart-finances:apps/api/src/ingest/schema.mjs#FIELDS, source csv, ids from hashId, import_batch from batchId.
  - An unreadable row becomes an issue { ref, line, issue }; a missing header throws.
- Verify: `node --test apps/api/test/csv.test.mjs` → T-IMP-2 passes
- Done when: verify is green and evidence is recorded

### SF-23 · Workbook caps
- Implements: AC-6, D-25 · After: SF-20 · Judgment: high
- Files: smart-finances:apps/api/src/ingest/xlsx.mjs#readWorkbook, apps/api/test/xlsx.test.mjs (new)
- Tests first: T-IMP-3
- Do:
  - Enforce the Values caps before inflating; inflate only xl/workbook.xml, its rels, sharedStrings and the sheets it reads.
  - Build the hostile zips in the test from code (many entries; parts that inflate past the total); no binary fixture.
- Verify: `node --test apps/api/test/xlsx.test.mjs apps/api/test/excel.test.mjs` → T-IMP-3 and the existing excel tests pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-24 · Export the duplicate check
- Implements: AC-13, AC-20 · After: SF-20 · Judgment: normal
- Files: smart-finances:apps/api/src/ingest/reconcile.mjs#combine, smart-finances:apps/api/src/ingest/reconcile.mjs#findPossibleDuplicates (new), apps/api/test/reconcile.test.mjs (new)
- Tests first: T-IMP-4, T-IMP-5
- Do:
  - Move combine's possible-duplicate loop into findPossibleDuplicates(issues, transactions), exported; combine calls it and returns the same output.
  - Re-run `npm run ingest:local`, then `diff -r -I '^Generated ' data/real/clean-baseline data/real/clean` (T-IMP-5; it ignores the report's timestamp line).
- Verify: `node --test apps/api/test/reconcile.test.mjs` → T-IMP-4 passes; `diff -r -I '^Generated ' data/real/clean-baseline data/real/clean` prints nothing
- Done when: both are recorded in progress

### SF-25 · Import record and period lock
- Implements: AC-4, AC-6, D-16, D-28, D-30 · After: SF-21 · Judgment: high
- Files: apps/api/src/store/imports.mjs (new), apps/api/src/store/ulid.mjs (new), apps/api/test/imports.test.mjs (new)
- Tests first: T-REC-1
- Do:
  - createImport (status requested, expires_at = now + 15 minutes) and takeLock: one conditional transaction that moves requested to importing and sets the period's lock per "States and exits", with the erase check of Contracts "Rollup".
  - Refusals give failed (another live lock, after expires_at, erase window) or ignored (final record, or a live lock held by another run) as the table says.
- Verify: `node --test apps/api/test/imports.test.mjs` → T-REC-1 passes
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-26 · Commit and reconcile
- Implements: AC-7, AC-8, D-9, D-28 · After: SF-24, SF-25 · Judgment: high
- Files: apps/api/src/store/imports.mjs, apps/api/test/imports.test.mjs
- Tests first: T-REC-2, T-REC-3, T-REC-4, T-REC-7
- Do:
  - Same content_hash as the active import: unchanged, then reconcile. Else commit: move the pointer (append to history) only if this record holds the lock and the active import id sorts before it; else superseded and release.
  - reconcile per Contracts "Parser input": put the active file's rows (with period and import_id), delete stored rows of that source and period not in the set (read per D-32: TXN#<yyyy-mm> range filtered on source for a month period, all TXN filtered on source and period for log), mark done and supersede older open imports, release the lock.
  - Run findPossibleDuplicates against the person's stored rows before the puts.
- Verify: `node --test apps/api/test/imports.test.mjs` → T-REC-1 to T-REC-4 and T-REC-7 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-27 · POST /imports
- Implements: AC-4, AC-6, D-15 · After: SF-25 · Judgment: high
- Files: apps/api/src/handlers/write.mjs (new), apps/api/test/write-imports.test.mjs (new)
- Tests first: T-API-1, T-API-2
- Do:
  - Validate source, file_name and size per the Values; create the record; key uploads/<sub>/<importId> from keys.mjs.
  - Build the form with presignPost from the store (exact key condition, content-length-range, 900 s expiry); return 201 { import_id, upload: { url, fields }, expires_at }.
- Verify: `node --test apps/api/test/write-imports.test.mjs` → T-API-1 and T-API-2 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-28 · Parser handler
- Implements: AC-4, AC-5, AC-6, D-15 · After: SF-22, SF-23, SF-26 · Judgment: high
- Files: apps/api/src/handlers/parser.mjs (new), apps/api/test/parser.test.mjs (new)
- Tests first: T-IMP-6, T-IMP-7, T-IMP-8
- Do:
  - Import mode: take sub and importId from the event's key per Contracts "S3 keys"; a missing record deletes the object and writes nothing.
  - Run the source's importer, periodOf, then lock, commit and reconcile. Record counts, every skipped row as { where, reason }, checks, and error { code, message } on failure.
  - Unknown content, an importer throw, a period that differs from a held lock, more than 2,000 unreadable rows, or a month-period row dated outside its month (D-32): failed, no rows written.
  - Reconcile mode: { sub, import_id } runs reconcile only.
- Verify: `node --test apps/api/test/parser.test.mjs` → T-IMP-6 to T-IMP-8 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-29 · Undo and repair
- Implements: AC-9, D-17, D-28 · After: SF-27, SF-28 · Judgment: high
- Files: apps/api/src/handlers/write.mjs, apps/api/src/store/imports.mjs, apps/api/test/write-imports.test.mjs
- Tests first: T-REC-5, T-REC-6
- Do:
  - POST /imports/{id}/undo and POST /periods/{source}/{period}/repair exactly as the notes below the HTTP routes table say; invoke the parser with invokeAsync(PARSER_FUNCTION, { sub, import_id }).
  - Tests run the parser's reconcile in process in place of the invoke.
- Verify: `node --test apps/api/test/write-imports.test.mjs apps/api/test/imports.test.mjs` → T-REC-5 and T-REC-6 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-30 · GET /imports and GET /imports/{id}
- Implements: AC-4, AC-5, AC-6 · After: SF-26 · Judgment: normal
- Files: apps/api/src/handlers/read.mjs (new), apps/api/test/read-imports.test.mjs (new)
- Tests first: T-API-3
- Do:
  - List IMP# items newest first, paged with an opaque cursor; active is true when the period pointer names the import.
  - Show stalled for importing past lock_until, and expired, with the reason that the file never arrived, for requested past expires_at.
- Verify: `node --test apps/api/test/read-imports.test.mjs` → T-API-3 passes
- Done when: verify is green and evidence is recorded

### SF-31 · Wire the import functions
- Implements: AC-1, D-15, D-21 · After: SF-27, SF-28, SF-29, SF-30 · Judgment: high
- Files: smart-finances:infra/lib/api-stack.ts#ApiStack, infra/test/api-stack.test.ts
- Tests first: T-INF-9
- Do:
  - api-read (GET /imports, GET /imports/{id}), api-write (POST /imports, undo, repair) and parser with makeFunction; every route binds ApiStack's JWT authorizer; sizes and grants exactly as Components "API stack" says for them; TABLE_NAME, BUCKET_NAME and PARSER_FUNCTION as env.
  - An EventBridge rule for Object Created in the bucket with key prefix uploads/ targets the parser.
- Verify: `cd infra && node --require ts-node/register --test test/api-stack.test.ts` → T-INF-7, T-INF-8 and T-INF-9 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-32 · Full verify and draft PR
- Implements: none · After: SF-21 to SF-31 · Judgment: normal
- Files: none beyond earlier tasks
- Tests first: none
- Do:
  - Run the full verify, `cd infra && npx cdk synth -c stage=qa` with AWS_PROFILE unset (SSM values are deploy-time parameters, so no lookup), and the ingest:local diff once more; then `rm -r data/real/clean-baseline`.
  - Push feature/data-imports and open a draft PR into qa with the PR body below.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` → all green
- Done when: the draft PR is open and the hand-back report is in the PR body and the final chat message

## Stop and hand back when
- A task would deviate from a decision. Record the deviation first.
- A value this brief needs is missing.
- Verify is still red after 2 fix rounds.
- A change is needed outside the task's Files.
- Credentials or production access are needed, including a push or gh call that fails on the machine's existing login.
- The ingest:local output differs from the SF-20 baseline.
- The next step is a push to a protected branch, marking a PR ready, or a merge.
- The draft PR is open and its body is checked.

## Hand-back report
- PR: link and state
- Tool and model: as recorded in progress
- Baseline → final: tests, lint, typecheck
- Tasks: done and blocked, with commit shas
- Deviations: each with the decision it touches and the proposal
- Surprises: what this brief did not predict, with evidence
- Next HUMAN step

## PR body
- No PR template exists. Include: what changed per task id, test ids and results, the ingest:local diff result, deviations, and the HUMAN steps left. Attribution follows the tool's own settings; never hard-code a model.
