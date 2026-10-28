---
spec: data-architecture
ticket: none
tier: L
status: locked-v1
---
# Data architecture: model, store, access patterns, ingestion and auth: brief for smart-finances (PR 3 of 3, reads)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. -->

- Goal: the owner can list, total, review, convert, export and delete their data, month totals stay correct, and a second account sees nothing.
- Implements: AC-2, AC-3, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, D-7, D-8, D-14, D-26, D-27, D-29, D-30
- Spec folder: /Users/v/projects/smart-finances/.claude/worktrees/data-architecture/docs/specs/data-architecture
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git -C /Users/v/projects/smart-finances fetch origin qa`, then `node ~/.claude/skills/spec/scripts/drift.mjs <spec folder> --strict` (exit 0; NEW lines are expected)
- Worktree: /Users/v/projects/smart-finances/.claude/worktrees/data-reads
- Branch: feature/data-reads · Base: origin/qa, after PR 2 (feature/data-imports) is merged into qa
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances-reads.md@locked-vN in progress-smart-finances-reads.json
- Order: PR 3 of 3.
- From PR 1 and PR 2 (read the code after SF-40): apps/api/src/store/keys.mjs, memory.mjs and repo.mjs (store and files interface, ConditionFailed), apps/api/src/handlers/http.mjs (HttpError, personOf, reply, fail), infra/lib/function.ts#makeFunction, ApiStack's public JWT authorizer, apps/api/src/store/imports.mjs (import core, whose lock writes already carry the erase check), handlers read.mjs, write.mjs and parser.mjs, and infra/test/*.test.ts. All SDK packages, @aws-sdk/client-lambda included, are already installed.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "Data stack", "API stack", "Handlers"; Contracts "Identity", "Table items", "HTTP routes", "Rollup"; "States and exits" rows month total stale, erasing and quiet; Cross-cutting "Security and permissions".
4. CLAUDE.md or AGENTS.md in the worktree, if present.
5. test-matrix.md rows whose task is SF-41 to SF-51.
6. progress-smart-finances-reads.json: baseline, then per task status, commit, evidence (command and result), review; deviations and surprises as lists.

## HUMAN needs
- PR 2 merged into qa before SF-40.

## Global constraints
- D-4: Roles: the agent writes code, commits, pushes feature branches and opens PRs into qa; the user reviews, merges and promotes. Source: how PRs 1 and 2 ran, and the profile's human-only list (default).
- D-3: Agent access: local tests, builds, CDK synth and the local import, plus read-only AWS calls with the personal profile. No AWS writes; the user runs anything that changes the account.
- D-6: Every stored item, uploaded file and review choice is filed under the signed-in person's identity, even with one user.
- D-7: Amounts stay in their recorded currency; a dollar view converts pesos with one monthly rate the owner enters, stored apart from the rows.
- D-8: Source files are the record: notes log and budget workbook rows are corrected in the file and re-uploaded. Review choices are stored only for payments report rows, kept apart and applied on top.
- D-14: Month totals: a stream consumer recomputes each touched month from its rows and review choices and writes the total only if no newer computation exists; empty months get tombstones; an erase marker stops late writes. Keeps ADR 0003's stream rollups.
- D-26: List, text search, review list and export read one person's rows for the asked months and filter, sort and page in the function.
- D-27: The dollar view is computed when read, from rates stored as pesos per dollar with two decimals, using integer cents.
- D-29: Extends D-12 for D-14: adds SUM#<yyyy-mm> month totals and one ERASED marker per person, and review choices move to OVR#<date>#<id> so the rollup finds them by month.
- D-30: After delete-all, imports, undo, repair and totals are refused for a quiet window of 65 minutes, so no late background work can bring erased data back.
- Values:
  - Review reasons are the flags needs_review and possible_duplicate. approved true hides both for that row, in lists, review and export. Review choices apply before filters.
  - Timestamps are ISO 8601 UTC strings except computed_at (ms epoch). Totals are stored as { kind: { category: { currency: cents } } }.
  - Rounding in the dollar view is half away from zero.
  - SSM: /smart-finances/<stage>/table-stream-arn. Env: ROLLUP_FUNCTION on api-write, next to TABLE_NAME, BUCKET_NAME and PARSER_FUNCTION.
  - q matches, case-insensitively, a substring of description_raw, merchant or category. Ties in a sort break by date, then id.
  - Cursor: base64url of { offset, hash }, where hash is a sha-256 of the query without cursor.
  - Rates: month yyyy-mm; ars_per_usd a string with exactly two decimals, above 0.00; else bad_request.
  - Export: text columns (every field except amount) whose first character is =, +, -, @, tab or carriage return get a leading single quote.
  - DELETE /data needs { confirm: "DELETE" }, else bad_request. quiet_until = erase end + 65 minutes.
  - Totals during the erase window: GET /totals answers conflict.
  - Stream: keys only. Rollup: 512 MB, 60 s; starting position TRIM_HORIZON; filter on sk prefix TXN# or OVR#; batch 100; parallelization 1; bisect on error; 3 retries; record age 1 hour; on-failure SQS queue, 14-day retention; alarm on Maximum of ApproximateNumberOfMessagesVisible greater than 0, 1 evaluation period of 60 s, missing data not breaching, to SNS topic smart-finances-<stage>-rollup-failures.
  - api-delete: 256 MB, 25 s.
- Rules: README.md "Layout" (only data/synthetic is committed).
- Public repo: tests and fixtures use synthetic data only. No personal data, names, account ids or real figures anywhere committed.
- Logs carry ids, counts and status only: no descriptions, amounts or object keys.

## ALWAYS / ASK FIRST / NEVER
**ALWAYS**
- Build every key through apps/api/src/store/keys.mjs; take the person only from personOf.
- Write the test first and see it fail. One task, one commit. Put the test id in the test title.
- Record each verify command and its result in progress-smart-finances-reads.json before the next task.

**ASK FIRST**
- Adding or upgrading any dependency.
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
- Run cdk deploy or any AWS write, or invoke a deployed function. cdk synth without credentials only.
- Merge, mark a PR ready, promote, push a protected branch, write to cloud resources, read production or enter a password.
- Edit a decision. Record a deviation in progress-smart-finances-reads.json and stop.

## Tasks

### SF-40 · Record the baselines
- Implements: none · After: none · Judgment: normal
- Files: none (no change)
- Tests first: none
- Do:
  - Create the worktree and branch from origin/qa (with PR 2 merged); symlink data/real to /Users/v/projects/smart-finances/data/real.
  - Run npm ci, then every verify command once, before any change.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` → results recorded under baseline
- Done when: the baseline is recorded and the worktree is clean

### SF-41 · Table stream
- Implements: D-14 · After: SF-40 · Judgment: high
- Files: smart-finances:infra/lib/data-stack.ts#DataStack, infra/test/data-stack.test.ts
- Tests first: T-INF-10
- Do:
  - Turn on the table stream, keys only; publish its ARN as SSM parameter table-stream-arn.
  - T-INF-5 (the replacement guard) must still pass unchanged.
- Verify: `cd infra && node --require ts-node/register --test test/data-stack.test.ts` → T-INF-2 to T-INF-5 and T-INF-10 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-42 · Month totals core
- Implements: AC-11, AC-12, D-14, D-29 · After: SF-40 · Judgment: high
- Files: apps/api/src/store/totals.mjs (new), apps/api/test/totals.test.mjs (new)
- Tests first: T-ROL-1, T-ROL-2
- Do:
  - recomputeMonth(person, month, now) exactly as Contracts "Rollup": consistent query of TXN and OVR for the month, sums with review choices applied, one transaction with the ERASED condition check and the computed_at condition; an empty month writes a tombstone.
  - A failed condition returns { skipped: true }, not an error.
- Verify: `node --test apps/api/test/totals.test.mjs` → T-ROL-1 and T-ROL-2 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-43 · Rollup handler and rebuild
- Implements: AC-11, AC-12, D-14 · After: SF-42 · Judgment: high
- Files: apps/api/src/handlers/rollup.mjs (new), apps/api/src/handlers/write.mjs, apps/api/test/rollup.test.mjs (new)
- Tests first: T-ROL-3, T-ROL-4
- Do:
  - Stream input: group records by person and month (ignore keys other than TXN# and OVR#), call recomputeMonth once per pair; throw on an unexpected error so the batch retries.
  - Rebuild input { sub, months: "all" }: every month that has a TXN item or a SUM item.
  - POST /totals/rebuild in write.mjs invokes the rollup async and returns 202 { months }.
- Verify: `node --test apps/api/test/rollup.test.mjs` → T-ROL-3 and T-ROL-4 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-44 · GET /transactions
- Implements: AC-10, AC-14, D-26 · After: SF-40 · Judgment: normal
- Files: apps/api/src/store/query.mjs (new), apps/api/src/handlers/read.mjs, apps/api/test/query.test.mjs (new)
- Tests first: T-API-4, T-API-5
- Do:
  - Query TXN#<from> to TXN#<to> and OVR# for the same range; apply review choices; filter, sort and page per the route row and the Values.
  - Over 36 months, a bad sort or limit, or a cursor from another query: bad_request.
- Verify: `node --test apps/api/test/query.test.mjs` → T-API-4 and T-API-5 pass
- Done when: verify is green and evidence is recorded

### SF-45 · Rates and GET /totals
- Implements: AC-11, AC-16, D-7, D-27 · After: SF-42 · Judgment: high
- Files: apps/api/src/store/rates.mjs (new), apps/api/src/handlers/read.mjs, apps/api/src/handlers/write.mjs, apps/api/test/rates.test.mjs (new)
- Tests first: T-API-6, T-API-7
- Do:
  - GET /rates, PUT /rates/{month} per the Values.
  - GET /totals takes from and to like GET /transactions, answers conflict inside the erase window, reads SUM items, skips tombstones; view usd converts ARS with round(ars cents x 100 / rate hundredths), passes USD through, and names months with pesos and no rate in missing_rates.
- Verify: `node --test apps/api/test/rates.test.mjs` → T-API-6 and T-API-7 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-46 · Review list and review choices
- Implements: AC-13, AC-14, AC-15, D-8 · After: SF-44 · Judgment: high
- Files: apps/api/src/store/review.mjs (new), smart-finances:apps/api/src/ingest/categories.mjs#CATEGORIES (new), apps/api/src/handlers/read.mjs, apps/api/src/handlers/write.mjs, apps/api/test/review.test.mjs (new)
- Tests first: T-API-8, T-API-9, T-API-10
- Do:
  - CATEGORIES lists every category string the importers can emit; a test fails when an importer emits one not in it.
  - GET /review: rows with a review reason that no approved choice hides, each with reasons.
  - PUT /transactions/{id}/review per the notes below the routes table; source other than mercadopago gives source_file_only.
  - T-API-9 re-imports the same payments report through PR 2's import core and expects the choice still applied.
- Verify: `node --test apps/api/test/review.test.mjs` → T-API-8 to T-API-10 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-47 · GET /export
- Implements: AC-17 · After: SF-44 · Judgment: normal
- Files: apps/api/src/handlers/read.mjs, apps/api/test/export.test.mjs (new)
- Tests first: T-API-11
- Do:
  - text/csv with the FIELDS columns in order, review choices applied, the Values neutralising rule, and the existing toCsv quoting.
- Verify: `node --test apps/api/test/export.test.mjs` → T-API-11 passes
- Done when: verify is green and evidence is recorded

### SF-48 · Delete-all and the quiet window
- Implements: AC-18, D-30 · After: SF-43, SF-45 · Judgment: high
- Files: apps/api/src/store/erase.mjs (new), apps/api/src/handlers/delete.mjs (new), apps/api/test/erase.test.mjs (new)
- Tests first: T-ERA-1, T-ERA-2, T-ERA-3
- Do:
  - Follow the erasing and quiet rows of "States and exits": refuse with conflict while a lock is live or an import is requested and unexpired; write ERASED with erased_at; delete every other item under the person and every object under uploads/<sub>/; then set quiet_until.
  - A repeat call with quiet_until unset finishes the erase.
  - T-ERA-2 drives imports, undo, repair, rollups and GET /totals inside the window.
- Verify: `node --test apps/api/test/erase.test.mjs` → T-ERA-1 to T-ERA-3 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-49 · Second-account test
- Implements: AC-2, AC-3, D-6 · After: SF-45, SF-46, SF-47, SF-48 · Judgment: high
- Files: apps/api/test/isolation.test.mjs (new)
- Tests first: T-AUTH-3
- Do:
  - Seed person A through the handlers (an import, a review choice, a rate, totals). As person B, call every route; expect empty lists, not_found or zero counts, and A's items and objects untouched after B's delete-all.
  - Pin the route count at 15 so a new route fails until it is added here. Seed A's import through the write handler, then the parser handler with a synthetic Object Created event.
- Verify: `node --test apps/api/test/isolation.test.mjs` → T-AUTH-3 passes
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-50 · Wire the read, rollup and delete functions
- Implements: AC-1, D-14, D-21 · After: SF-41, SF-43, SF-48 · Judgment: high
- Files: smart-finances:infra/lib/api-stack.ts#ApiStack, infra/test/api-stack.test.ts
- Tests first: T-INF-11, T-INF-12
- Do:
  - Add the remaining routes of Contracts "HTTP routes" to api-read, api-write and api-delete; add rollup with the stream source, queue, alarm and topic per the Values; grants exactly as Components "API stack".
  - T-INF-11: all 15 routes exist and every one but GET /health has the JWT authorizer. T-INF-12: the event source mapping and alarm settings.
- Verify: `cd infra && node --require ts-node/register --test test/api-stack.test.ts` → T-INF-7 to T-INF-9, T-INF-11 and T-INF-12 pass
- Done when: verify is green, evidence is recorded, and the reviewer has no blocker

### SF-51 · Staging check script
- Implements: AC-3, AC-4 · After: SF-50 · Judgment: normal
- Files: scripts/api-call.mjs (new), apps/api/test/api-call.test.mjs (new), README.md
- Tests first: T-OPS-1
- Do:
  - `node scripts/api-call.mjs --stage <stage> --as <sub> <METHOD> <path> [json]` builds an HTTP API event with that sub in the JWT claims and invokes smart-finances-<stage>-api-read, -api-write or -api-delete with the caller's AWS profile; `--upload <file>` posts a file to a returned form.
  - The test checks the built event only; it never calls AWS. README.md documents the script for release checks.
- Verify: `node --test apps/api/test/api-call.test.mjs` → T-OPS-1 passes
- Done when: verify is green and evidence is recorded

### SF-52 · Full verify and draft PR
- Implements: none · After: SF-41 to SF-51 · Judgment: normal
- Files: none beyond earlier tasks
- Tests first: none
- Do:
  - Run the full verify and `cd infra && npx cdk synth -c stage=qa`.
  - Push feature/data-reads and open a draft PR into qa with the PR body below.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` → all green
- Done when: the draft PR is open and the hand-back report is written

## Stop and hand back when
- A task would deviate from a decision. Record the deviation first.
- A value this brief needs is missing.
- Verify is still red after 2 fix rounds.
- A change is needed outside the task's Files.
- Credentials or production access are needed, including a push or gh call that fails on the machine's existing login.
- The next step is a push to a protected branch, marking a PR ready, or a merge.
- The draft PR is open and its body is checked.

## Hand-back report
- PR: link and state
- Tool and model: as recorded in progress
- Baseline → final: tests, lint, typecheck
- Tasks: done and blocked, with commit shas
- Deviations: each with the decision it touches and the proposal
- Surprises: what this brief did not predict, with evidence
- Next HUMAN step: release.md staging checks

## PR body
- No PR template exists. Include: what changed per task id, test ids and results, deviations, and the HUMAN steps left (release.md). Attribution follows the tool's own settings; never hard-code a model.
