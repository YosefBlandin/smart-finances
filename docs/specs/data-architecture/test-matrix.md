---
spec: data-architecture
ticket: none
tier: L
status: locked-v2
---
# Data architecture: model, store, access patterns, ingestion and auth: test matrix

<!-- One row per test, written at handoff: id (T-AREA-n), traces (AC or decision ids), task (a task id from a pr file, or manual), level (unit, int, e2e or manual), gate (G-merge, G-promote or none), check (one line). -->
<!-- Put the id in the real test title so grep finds it. Executors read only their own PR's rows. spec-lint checks that every AC is traced by a row or named in "Accepted, no test", and that every row names a task or manual, so there is no separate traceability table. Examples sit in these comments. -->

## Automated
<!-- unit and int rows, grouped by PR. Keep the check terse: one line, no Given/When/Then. When the change classifies a set (routes, keys, types), add one coverage test that pins the count, so a new member fails CI until someone classifies it. -->
| Test | Traces | Task | Level | Gate | Check |
|---|---|---|---|---|---|
| T-DOC-1 | D-6, D-8, D-9, D-10, D-12, D-13, D-14, D-16, D-17, D-26, D-28, D-29 | SF-1 | unit | G-merge | ADRs 0004, 0006 and 0007 exist, cite their D ids, and docs/adr/README.md lists them as accepted. |
| T-DOC-2 | AC-19, D-10, D-19 | SF-2 | unit | G-merge | docs/threat-model.md names the table, bucket, user pool, upload path, delete-all, the 35-day window and the D-10 risk. |
| T-INF-1 | D-20, D-22 | SF-3 | unit | G-merge | Every stack of a stage synthesizes under node --test. |
| T-INF-2 | AC-19, D-12, D-13, D-19 | SF-4 | unit | G-merge | Table: pk and sk strings, on-demand, PITR on, AWS-owned key; RETAIN and deletion protection in staging and prod only. |
| T-INF-3 | AC-19, D-13, D-15, D-19 | SF-4 | unit | G-merge | Bucket: public access blocked, SSE-S3, TLS-only policy, no versioning, EventBridge on, CORS POST from webOrigins only. |
| T-INF-4 | AC-1, D-18 | SF-5 | unit | G-merge | Pool: self sign-up off, MFA required TOTP only, RETAIN in every stage; client has no secret and only SRP and refresh. |
| T-INF-5 | D-13 | SF-5 | unit | G-merge | Logical ids, key schema and sign-in attributes of the table and pool equal the pinned values. |
| T-INF-6 | D-13, D-22 | SF-6 | unit | G-merge | Each stage has a data and an api stack; the api stack depends on the data stack and uses no CloudFormation imports. |
| T-INF-7 | AC-1, D-18 | SF-9 | unit | G-merge | GET /health has no authorizer; there is no default route; throttling is 10 and 20; functions are named smart-finances-<stage>-<name>. |
| T-INF-8 | D-21 | SF-9 | unit | G-merge | No function role policy has a "*" resource. |
| T-AUTH-1 | AC-1, AC-2, D-6 | SF-7 | unit | G-merge | personOf returns the claims sub and throws unauthorized when it is missing or empty, whatever the path, query or body say. |
| T-AUTH-2 | AC-1 | SF-7 | unit | G-merge | reply maps each error code to its status and the { error: { code, message } } body. |
| T-KEY-1 | AC-2, D-12, D-29 | SF-8 | unit | G-merge | Every key kind is built from person and parts and pins the count of 7 kinds; another person never yields the same pk. |
| T-KEY-2 | D-12 | SF-8 | unit | G-merge | The memory store honours conditions, all-or-nothing transactions and sort-key range and prefix queries. |
| T-KEY-3 | D-12 | SF-8 | unit | G-merge | With a stubbed client, repo.mjs turns conditions into a ConditionExpression and a transaction cancellation into ConditionFailed with the item index. |
| T-CI-1 | D-22 | SF-10 | unit | G-merge | deploy.yml runs npm test before credentials and deploys the data stack before the api stack. |
| T-IMP-1 | AC-4, D-16 | SF-21 | unit | G-merge | periodOf per source; a payments report with rows outside its month adds one skipped entry with the count. |
| T-IMP-2 | AC-4, AC-5, D-23 | SF-22 | unit | G-merge | The synthetic CSV parses into schema rows with stable ids; a bad row becomes an issue; no header throws. |
| T-IMP-3 | AC-6, D-25 | SF-23 | unit | G-merge | Workbooks over the entry or total-inflate cap fail before inflating; unread parts are never inflated. |
| T-IMP-4 | AC-13, AC-20 | SF-24 | unit | G-merge | findPossibleDuplicates flags the same rows combine flagged before; combine output is unchanged on fixtures. |
| T-IMP-6 | AC-4, AC-5 | SF-28 | int | G-merge | A file with some bad rows imports the rest, records counts and every skipped row with its reason. |
| T-IMP-7 | AC-6 | SF-28 | int | G-merge | Unknown content, a throwing importer, over 2,000 bad rows, or a missing record store no rows and record why. |
| T-IMP-8 | D-16, D-32 | SF-28 | int | G-merge | A payments report or workbook result with a row dated outside its month fails with no rows written; the real importers' synthetic fixtures never trigger it. |
| T-REC-1 | AC-6, D-16, D-28, D-30 | SF-25 | unit | G-merge | The lock moves requested to importing once; a live lock, an expired form, or the erase window refuses as States and exits say. |
| T-REC-2 | AC-7 | SF-26 | int | G-merge | The same file twice stores its rows once and the second import ends unchanged. |
| T-REC-3 | AC-8, D-9 | SF-26 | int | G-merge | A corrected file for a period replaces its rows; other sources and periods keep theirs. |
| T-REC-4 | AC-7, AC-8, D-28 | SF-26 | int | G-merge | Late retry of an older import, one event twice and concurrent, crash after some puts then retry, takeover after lock_until: rows equal the active file. |
| T-REC-7 | D-28, D-32 | SF-26 | unit | G-merge | Reconcile of a month period queries only TXN#<yyyy-mm> and leaves other months' rows of the same source untouched; a log period reads all and keeps other sources. |
| T-API-1 | AC-4, AC-6 | SF-27 | unit | G-merge | POST /imports refuses a bad source or name with bad_request and an over-cap size with too_large. |
| T-API-2 | D-15 | SF-27 | unit | G-merge | The form allows exactly uploads/<sub>/<importId>, 1 byte to the cap, and expires in 15 minutes. |
| T-REC-5 | AC-9, D-17 | SF-29 | int | G-merge | Undo restores the previous file's rows, or none; undo of a non-active import or a repeat undo gets conflict. |
| T-REC-6 | AC-7, AC-8, D-28 | SF-29 | int | G-merge | Repair finishes a stalled import; repair overlapping an import is refused; a payments report correction that crashed is fixed by repair. |
| T-API-3 | AC-4, AC-5, AC-6 | SF-30 | unit | G-merge | GET /imports is newest first with active, stalled and expired shown; GET /imports/{id} returns the record or not_found. |
| T-INF-9 | AC-1, D-15, D-18, D-21 | SF-31 | unit | G-merge | The JWT authorizer has the pool issuer and client audience and guards every import route; the uploads/ Object Created rule targets the parser; grants match. |
| T-INF-10 | D-14 | SF-41 | unit | G-merge | The table stream is keys only and its ARN is in SSM; T-INF-5 still passes. |
| T-ROL-1 | AC-11, D-14 | SF-42 | unit | G-merge | A month total equals the sum of its rows by kind, category and currency, with review choices applied. |
| T-ROL-2 | AC-12, D-14, D-29 | SF-42 | unit | G-merge | A recompute twice, two interleaved recomputes and a stale one after an erase leave the newest total; an empty month gets a tombstone. |
| T-ROL-3 | AC-12 | SF-43 | unit | G-merge | One stream batch delivered twice leaves totals unchanged; keys other than TXN and OVR are ignored. |
| T-ROL-4 | AC-11 | SF-43 | unit | G-merge | Rebuild recomputes every month with a TXN or SUM item and returns their count. |
| T-API-4 | AC-10, D-26 | SF-44 | unit | G-merge | List filters by month range, category, kind and text, sorts by date or amount both ways, and pages to the end. |
| T-API-5 | AC-10 | SF-44 | unit | G-merge | Over 36 months, a bad sort or limit, or a cursor from another query gives bad_request. |
| T-API-6 | AC-11, AC-16 | SF-45 | unit | G-merge | GET /totals returns stored totals and skips tombstones; the native view keeps every currency. |
| T-API-7 | AC-16, D-27 | SF-45 | unit | G-merge | The usd view rounds as specified, passes USD through, and lists months without a rate; a bad rate gives bad_request. |
| T-API-8 | AC-13 | SF-46 | unit | G-merge | GET /review returns every row with needs_review or possible_duplicate that no approval hides, with reasons. |
| T-API-9 | AC-14, D-8 | SF-46 | int | G-merge | An approval and a category change on a payments report row survive a re-import of the same source. |
| T-API-10 | AC-15, D-8 | SF-46 | unit | G-merge | A review choice on a notes log or workbook row gives source_file_only; a missing row gives not_found; an unknown category gives bad_request. |
| T-API-11 | AC-17 | SF-47 | unit | G-merge | Export has the schema columns, review choices applied, and a leading quote on formula-like text but not on amounts. |
| T-ERA-1 | AC-18, D-30 | SF-48 | int | G-merge | Delete-all removes every item but ERASED and every object under the person's prefix, then sets quiet_until 65 minutes on. |
| T-ERA-2 | AC-18, D-30 | SF-48 | int | G-merge | Refused while a lock is live; in the window, imports, undo, repair and totals get conflict and rollups write nothing; after a stalled import it works. |
| T-ERA-3 | AC-18 | SF-48 | int | G-merge | A crash mid-erase leaves quiet_until unset and everything refused; a repeat call finishes it. |
| T-AUTH-3 | AC-2, AC-3, D-6 | SF-49 | int | G-merge | Person B sees and changes none of person A's rows, imports, choices, rates, totals or files, on all 15 routes. |
| T-INF-11 | AC-1, D-18 | SF-50 | unit | G-merge | All 15 routes exist and all but GET /health use the JWT authorizer. |
| T-INF-12 | D-14 | SF-50 | unit | G-merge | The rollup stream source, on-failure queue, alarm and topic match the brief's values. |
| T-OPS-1 | AC-3, AC-4 | SF-51 | unit | G-merge | api-call builds an HTTP API event with the given sub in its claims and picks the right function per method and path. |

## End-to-end and manual
<!-- e2e rows and checks a person runs, in Given/When/Then. Fixtures use internal ids only; credentials never go in this folder. release.md says who runs each manual row and when. Example row: | T-E2E-1 | AC-1, D-1 | manual | manual | G-promote | Given a signed-in user, when they open a page that makes several calls, then exactly one page-view event appears. | -->
| Test | Traces | Task | Level | Gate | Check |
|---|---|---|---|---|---|
| T-IMP-5 | AC-20, D-2 | SF-24 | manual | G-merge | Given the SF-20 copies of the local import output, when npm run ingest:local runs on the same data/real files, then both files are identical apart from the report's Generated timestamp line. Run by the executor. |
| T-E2E-1 | AC-1 | manual | e2e | G-promote | Given staging is deployed, when GET /transactions is called with no token and with a malformed token, then both get 401 and no data. |
| T-E2E-2 | AC-4, AC-5 | manual | e2e | G-promote | Given the second test user, when data/synthetic/transactions.csv is uploaded with scripts/api-call.mjs, then its import ends done with counts and skipped rows listed. |
| T-E2E-3 | AC-7, AC-12 | manual | e2e | G-promote | Given T-E2E-2, when the same file is uploaded again, then the import ends unchanged and GET /totals is the same as before. |
| T-E2E-4 | AC-3 | manual | e2e | G-promote | Given T-E2E-2, when the owner user lists transactions, imports, review and rates, then none of the second test user's items appear. |
| T-E2E-5 | AC-18, D-30 | manual | e2e | G-promote | Given T-E2E-3, when the second test user deletes all data, then the counts return; after 65 minutes lists are empty and the bucket has no object under that user's prefix. |
| T-E2E-6 | AC-19, D-19 | manual | e2e | G-promote | Given staging is deployed, when the table and bucket are described read-only, then encryption, PITR and the public access block are on. |

## Accepted, no test
<!-- Edge cases, or ACs, closed by a decision or a risk instead of a test, with a one-line reason. Name the AC id when the row covers one. Example row: | Events written before the release have no page type. | RK-1 | They expire on their own; no backfill. | -->
| Edge case | Closed by | Reason |
|---|---|---|
| A review choice whose row vanished after a payments report correction. | RK-5 | Payment report ids are stable per operation; orphaned choices are ignored on read and removed by delete-all. |
| Admin roles of other projects in the account can read the data. | RK-6, D-10 | Accepted by the owner for now. |
| Excel amounts pass through a float before cents. | RK-7 | Two-decimal values times 100 round exactly at these sizes; T-IMP-5 still matches. |
| The same payment imported from two sources. | RK-8 | Sources cover different periods; workbook duplicates are flagged for a source fix. |
| Skewed clocks let an older rollup win. | RK-9 | Hosts sync to milliseconds; the next change or a rebuild recomputes the month. |
| Log-period reconcile reads all history. | RK-11, D-32 | Below the trigger in RK-11 the cost is a few hundred read units. |
| Offset paging reads the whole range per page. | RK-12, D-32 | Below the trigger in RK-12 a range is about 1 MB. |
| Delete-all and export are synchronous. | RK-13, D-32 | Below the trigger in RK-13 both finish in seconds; a repeat delete-all resumes. |
