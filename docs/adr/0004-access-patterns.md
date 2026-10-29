# 0004: Access patterns, keys and stores

Status: accepted, 2026-10-28 (fills in what ADR 0003 deferred; 0003 itself is unchanged)

## Context
ADR 0003 chose one DynamoDB table with stream rollups and left the keys and access patterns for Epic 2. The data is one person's transactions, a few hundred to low thousands of items, plus the imports that produced them, the owner's review choices on payments report rows, monthly dollar rates and month totals. Every route must act only on the signed-in person's items, and the keys are hard to change once real data is loaded.

## Decisions
- **D-6**: Every stored item, uploaded file and review choice is filed under the signed-in person's identity, even with one user.
- **D-12**: One table per stage. Partition key is the person (U# plus the sign-in sub); sort key prefixes TXN, OVR, IMP, PER and RATE as in architecture.md Contracts "Table items". No secondary index.
- **D-13**: A separate data stack per stage holds the table, the upload bucket and the user pool. The user pool is retained in every stage; the table and bucket are retained with deletion protection in staging and prod.
- **D-14**: Month totals: a stream consumer recomputes each touched month from its rows and review choices and writes the total only if no newer computation exists; empty months get tombstones; an erase marker stops late writes. Keeps ADR 0003's stream rollups.
- **D-26**: List, text search, review list and export read one person's rows for the asked months and filter, sort and page in the function.
- **D-29**: Extends D-12 for D-14: adds SUM#<yyyy-mm> month totals and one ERASED marker per person, and review choices move to OVR#<date>#<id> so the rollup finds them by month.

## Options

### Who owns an item (D-6)
- **Do nothing**: items carry no owner; only one person can ever use the store.
- **File every item under the signed-in person** (chosen): the second-account test needs it, and adding an owner later means rewriting every stored item. Cost: a little more key design now; ids alone do not include the owner.

### Key design (D-12)
- **Do nothing**: no table; data stays in local files.
- **One partition per person, typed sort keys, no index** (chosen): one person holds low thousands of items, so one partition answers every access pattern with a single query and keeps delete-all to one partition. Cost: every read goes through one partition per person; text search is a filter, not an index. Changing keys after real data loads means copying every item.
- **One partition per person and month, with an index for cross-month reads**: smaller partitions nobody needs at this size, and an index to keep consistent.
- **A relational database instead of DynamoDB**: revisits ADR 0003 for flexibility this data does not need.

### Where the stores live (D-13)
- **Do nothing**: the table, bucket and pool sit in the API stack, which uses delete-on-remove settings.
- **A separate data stack per stage; pool always retained; table and bucket retained in staging and prod** (chosen): the person key is the user's sign-in id, so a recreated pool would orphan every stored item, and API changes must never replace stores. Cost: removing a dev or qa stage leaves a retained pool to delete by hand.
- **One shared data stack for all stages**: test data and real data would share stores.

### Month totals (D-14)
- **Do nothing**: no totals anywhere; every client sums rows itself.
- **Add and subtract each change from the stream**: cheap per event, but the stream delivers records at least once, so duplicates double count without per-event bookkeeping.
- **Recompute each touched month from the stream, write only if no newer read won, with tombstones and an erase marker** (chosen): one consistent query of about 60 rows per touched month; correct under duplicates, retries and parallel runs. Cost: one more function, an on-failure queue and a rebuild route; a month can lag by seconds after a change.
- **Sum the asked months on every read**: simplest and correct by construction, but drops the plan's Streams goal.

### Totals and erase in the same partition (D-29)
- **Do nothing**: keep D-12's prefixes; totals and the erase marker would need another table.
- **Add SUM and ERASED items and month-prefixed review choice keys to the one partition** (chosen): the rollup finds a month's rows and choices with two range queries, and the erase check is one item in the same partition. Cost: the erase marker keeps the person id and an erase time after delete-all.

## Decision

### Stores
| Store | Where | Retention |
| --- | --- | --- |
| Table | data stack, one per stage; keys pk and sk, both strings; on-demand; point-in-time recovery on | retained with deletion protection in staging and prod; erased items stay restorable for the 35-day recovery window |
| Upload bucket | data stack; private; one object per import at `uploads/<sub>/<importId>` | raw files kept until delete-all, so undo can re-run them; retained in staging and prod |
| User pool | data stack; the sign-in sub is the person id | retained in every stage |

### Table items
One table. P = `U#<sub>`. All items of one person share one partition. Keys are built only in `apps/api/src/store/keys.mjs`; a key part that contains `#` or `/` is refused.

| Item | pk | sk | Attributes |
| --- | --- | --- | --- |
| Transaction | P | `TXN#<date>#<id>` | every schema field (amount as integer cents), period, import_id (the import whose file last wrote it) |
| Review choice | P | `OVR#<date>#<id>` | date, month, category (optional), approved (bool), updated_at; payments report rows only |
| Import | P | `IMP#<importId>` | the import record: kind, source, file, status, counts, skipped rows, checks, error |
| Period pointer | P | `PER#<source>#<period>` | active_import, history (import ids of the files that counted, oldest first, no repeats, no cap), lock_import, lock_until |
| Rate | P | `RATE#<yyyy-mm>` | ars_per_usd as a string with exactly two decimals, updated_at |
| Month total | P | `SUM#<yyyy-mm>` | totals: kind, then category, then currency, to integer cents; row_count; computed_at (ms epoch of the consistent read it came from); row_count 0 is a tombstone that readers skip |
| Erase marker | P | `ERASED` | erased_at, quiet_until (unset while erasing; the erase's end plus 65 minutes when it finishes); never removed |

importId is a ULID, so `IMP#` items sort by time. date is `YYYY-MM-DD`; id is the 16-hex row id; period is `yyyy-mm` or `log`. Text attributes are stored as imported and every reader treats them as untrusted.

### Access patterns
Every pattern below is a query or get on the signed-in person's partition only; P comes from the verified sub, never from the request. Ranged reads use `TXN#<from>` to `TXN#<to>`: the upper bound is `TXN#<to>~`, because `~` sorts after every date and id character, so the whole last month is read. `GET /review` and `GET /export` have no range and read every `TXN#` and `OVR#` item of the person.

| Route | Key condition | Filter |
| --- | --- | --- |
| GET /health | none (no table access) | none |
| POST /imports | get `ERASED`; put `IMP#<importId>` if absent | erase window refused |
| GET /imports | query `begins_with(sk, IMP#)`, newest first; query `begins_with(sk, PER#)` | active flag and stalled status computed in the function |
| GET /imports/{id} | get `IMP#<id>` | none |
| POST /imports/{id}/undo | get `IMP#<id>`, `PER#<source>#<period>`, `ERASED`; one transaction: put `IMP#<undoId>`, update `PER#<source>#<period>` | conditional on {id} being the active import and the lock being free |
| POST /periods/{source}/{period}/repair | get `PER#<source>#<period>`, `ERASED`; one transaction: put `IMP#<repairId>`, update `PER#<source>#<period>` | conditional on the lock being free |
| GET /transactions | query `sk BETWEEN TXN#<from> AND TXN#<to>~` and `sk BETWEEN OVR#<from> AND OVR#<to>~` | category, kind and text, then sort and page by offset, in the function |
| GET /totals | query `sk BETWEEN SUM#<from> AND SUM#<to>`; for the dollar view also `sk BETWEEN RATE#<from> AND RATE#<to>` | tombstones (row_count 0) skipped |
| GET /review | query `begins_with(sk, TXN#)` and `begins_with(sk, OVR#)` | rows still marked for review or as possible duplicates, review choices applied |
| PUT /transactions/{id}/review | get `TXN#<date>#<id>`; put `OVR#<date>#<id>` | source must be the payments report |
| GET /rates | query `begins_with(sk, RATE#)` | none |
| PUT /rates/{month} | put `RATE#<month>` | none |
| POST /totals/rebuild | query `begins_with(sk, TXN#)` and `begins_with(sk, SUM#)` for the months; async invoke of the rollup | erase window refused |
| GET /export | query `begins_with(sk, TXN#)` and `begins_with(sk, OVR#)` | review choices applied; formula-like text neutralised |
| DELETE /data | put `ERASED`; query the whole partition; delete every item except `ERASED`; list and delete `uploads/<sub>/`; update `ERASED` | refused while a period lock is live or an import is requested and unexpired |

Background work uses the same partition:

| Worker | Key condition | Filter |
| --- | --- | --- |
| parser, one-month period | get `IMP#<importId>`, `PER#<source>#<period>`, `ERASED`; query `sk BETWEEN TXN#<yyyy-mm> AND TXN#<yyyy-mm>~` | source |
| parser, log period | get as above; query `begins_with(sk, TXN#)` | source and period |
| rollup | consistent query of `TXN#<month>` and `OVR#<month>` ranges; transaction on `ERASED` and `SUM#<month>` | none |

### Rollup write rule
For each person and touched month: take t = now in ms; make a consistent-read query of the month's `TXN#` and `OVR#` items; sum by kind, category (review choice applied) and currency; then write in one transaction a condition check that `ERASED` is absent or t is after its quiet_until, and a put of `SUM#<month>` on the condition that it is absent or its computed_at is before t. A failed condition means newer data or an erase already won, and is not an error. An empty month writes a tombstone (row_count 0) the same way. Between erased_at and quiet_until no rollup writes anything, and imports, undo and repair are refused with conflict. quiet_until is 65 minutes after the erase ends, longer than the stream source's 1-hour record age.

## Consequences
- A handler cannot reach another person's items without building a key from another sub; keys come from one module and the person only from the verified token. IAM cannot scope a shared role to one partition, so this is enforced in code and proven by the second-account test.
- Reads load one person's asked months and filter in memory; each page of a list costs the whole range. Fine at this size; the triggers below say when to change it.
- Totals lag a change by seconds, and a stream batch that keeps failing lands in an on-failure queue whose alarm notifies the owner; the rebuild route repairs it.
- Delete-all leaves the `ERASED` marker, holding the person id and an erase time.

## Revisit when
- A person holds more than 20,000 transactions, or a list page takes more than a second: keyset paging on the sort key.
- A log-period import reads more than 20,000 items: a sparse index on transaction items keyed by person, source and period.
- Delete-all or export runs longer than 15 seconds: move them to async jobs.
