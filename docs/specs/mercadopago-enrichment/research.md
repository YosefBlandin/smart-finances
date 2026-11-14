---
spec: mercadopago-enrichment
ticket: none
tier: M
status: locked-v1
---
# Mercado Pago enrichment: merchant names, category codes and name-once recipient labels: research

<!-- Evidence only; the design lives in architecture.md. Line numbers are allowed only in this file, pinned to the refs in intent.md. This M spec keeps its facts here instead of in architecture.md, so each fact has one home. -->

## Scope
- Areas: import path, review and labels, privacy and secrets. Repo smart-finances at the intent.md ref, plus the uncommitted sync and probe scripts on the feature/mercadopago-sync worktree (marked "uncommitted").
- Produced by the spec-research workflow (3 area agents, 1 verifier re-checked 30 decision-critical facts), then two live checks run by the owner and one local header check.

## Facts
<!-- Tier M: the fact rows (F ids) live in architecture.md, Facts. Line-level evidence per fact: F-1 mercadopago.mjs:L13-24; F-2 mercadopago.mjs:L92; F-3 mercadopago.mjs:L47-52,L101; F-4 mercadopago.mjs:L28-45 and query.mjs:L7-22; F-5 mercadopago.mjs:L62,L93-110, schema.mjs:L9-10, parser.mjs:L27-28; F-6 fields.mjs:L4-19, routes.mjs:L27-44; F-7 imports.mjs:L232,L237-309; F-8 categories.mjs (contracts):L4-31, categories.mjs (ingest):L7-34; F-9 sources.mjs:L4-22, write.mjs:L30,L42; F-10 review.mjs:L1-51, write.mjs:L127-134; F-11 totals.mjs:L14-59, api-stack.ts:L228-241, rollup.mjs:L8-21; F-12 keys.mjs:L51-55; F-13 limits.ts:L34-47, api-stack.ts:L128-158; F-14 erase.mjs:L71-75, read.mjs:L129-142, en.json:L231-249; F-15 View.tsx:L58-110, memory/data-api.ts:L196-204; F-16 threat-model.md:L17-51,L60,L95; F-17 data-stack.ts:L36-66, ADR 0004:L45-50; F-18 web-stack.ts:L125-134,L176-190, api-stack.ts:L117-125; F-19 log.ts:L7-23, parser.mjs:L164; F-20 schema.mjs:L9-10, .gitignore:L14-23; F-21 mercadopago-sync.mjs:L241-259, mercadopago-probe.mjs:L83-160 (uncommitted). -->

## Corrections
| # | Earlier claim | Resolved fact | Evidence |
|---|---|---|---|
| 1 | The sync script's header says its logs carry months, file names, counts and statuses only. | Error lines can include a parser message that quotes a cell value, and up to 200 characters of an HTTP error body. | scripts/mercadopago-sync.mjs (uncommitted):L6,L216,L274,L322 |
| 2 | The report config default in mercadopago-report.mjs lists the columns the live reports have. | The live files have 15 columns, among them BUSINESS_UNIT, SUB_UNIT and PURCHASE_ID, which the default leaves out; the default was never applied. Applying it would break the parser (F-2). | live check 1; scripts/mercadopago-report.mjs:L67-74 |

## Assumptions
| Assumption | Importance | Evidence | Next step |
|---|---|---|---|
| The Payments API payment id equals the report SOURCE_ID for payments. | high | high | Settled by live check 2: 73 of 73 expenses and 14 of 14 inflows matched by id. |
| Merchant and payer names may contain ';' or '"', which break the parser (F-1). | high | high | Task: sanitize enrichment values, with a parser test for both characters. |
| Labeling thousands of rows through the single-row review route would hit the 120 per minute limit and the 10 s timeout (F-13). | high | high | Design fork: a bulk route or resolving labels without per-row writes. |
| New per-person items under the person's partition are erased by delete-all with no erase change (F-14). | high | high | Task: an erase test that seeds the new item kind. |
| Extra columns in an uploaded report persist in the raw bucket object until delete-all (F-17). | high | high | Covered by Q-3 and the threat model update. |
| A month's searches stay far below the 2,000-offset cap. | low | medium | Live check 2 read 97 and 20 payments for October. |
| A choice is orphaned if a re-imported row keeps its id but changes date, because choice keys hold the date. | medium | medium | Task: a re-import test where one operation's main row date moves. |

## Unknowns
| Unknown | Impact | Goes to |
|---|---|---|
| Should expenses that are still uncategorized after enrichment go on the review list? | high | Q-1 |
| Does naming a recipient also approve its rows, or only set the name and category? | high | Q-2 |
| May third-party names reach the qa data store and its 35-day restore window, or stay on the owner's machine? | high | Q-3 |
| Are recipient labels applied at import time (written into rows) or at read time (joined like choices), given the rollup reacts to TXN# and OVR# only (F-11)? | high | design fork |
| Where does the keyed-hash key live, is it shared between the owner's machine and the server, and what happens on rotation? | high | design fork, after Q-3 |
| Do the keyword rules work on real merchant strings, or do merchants need their own rules and a category-code map? | high | task: run the rules over the October merchant names locally and count matches |
| How many October rows share one recipient (the size of one bulk apply)? | medium | task: count per recipient key in the enriched October file, locally |
| Do sync and probe logs leak cell values or names on errors (correction 1)? | medium | task: tighten the error lines and test them |

## Live checks
| # | Check | Command or steps | Result | Date |
|---|---|---|---|---|
| 1 | Columns of the local reports | print only the header line of each file in data/real/mercadopago | 5 files, 15 columns each, including BUSINESS_UNIT, SUB_UNIT and PURCHASE_ID | 2026-11-14 |
| 2 | Payments API coverage for October (owner ran it) | mercadopago-report.mjs probe 2026-10, second version | Search as payer matched 73 of 73 expenses: 45 regular payments with 32 distinct descriptions, 22 with a merchant name and category code; 4 recurring with 3 distinct; 23 person-to-person with 2 distinct descriptions and an empty bank-info name. Search as collector matched 14 of 14 inflows, with payer email and ID number but no name. Payouts: 0 of 18; lookup by id answered 404 three times. | 2026-11-14 |
| 3 | Finished report status (owner ran sync) | mercadopago-report.mjs sync | The live list marks a finished report "enabled", not the documented "processed"; October saved with 129 operations, balance checks pass | 2026-11-14 |

## Resolved from code
| Question | Answer | Evidence |
|---|---|---|
| Why is almost all of October Uncategorized? | Mercado Pago rows get only Interest, Refunds, Shopping or Uncategorized, and no merchant (F-3). | smart-finances:apps/api/src/ingest/mercadopago.mjs:L47-52 |
| Will the parser accept enrichment columns? | Yes, if values hold no ';' or '"' (F-1). | smart-finances:apps/api/src/ingest/mercadopago.mjs:L17-24 |
| Does enriching a file change row ids or lose review choices? | No; ids come from SOURCE_ID and month, and choices live apart from rows (F-5, F-10). | smart-finances:apps/api/src/store/review.mjs:L1-51 |
| Does delete-all cover new per-person items? | Yes, anything under the person's partition (F-14). | smart-finances:apps/api/src/store/erase.mjs:L71-75 |
| Can the parser Lambda read a secret today? | No (F-18). | smart-finances:infra/lib/api-stack.ts:L117-125 |
| What is the next ADR number? | 0010. | smart-finances:docs/adr/README.md:L6-16 |
