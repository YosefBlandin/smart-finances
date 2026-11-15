---
spec: category-suggestions
ticket: none
tier: L
status: draft
---
# In-browser category suggestions with one-tap approval: test matrix

<!-- One row per test, written at handoff: id (T-AREA-n), traces (AC or decision ids), task (a task id from a pr file, or manual), level (unit, int, e2e or manual), gate (G-merge, G-promote or none), check (one line). -->
<!-- Put the id in the real test title so grep finds it. Executors read only their own PR's rows. spec-lint checks that every AC is traced by a row or named in "Accepted, no test", and that every row names a task or manual, so there is no separate traceability table. Examples sit in these comments. -->

## Automated
<!-- unit and int rows, grouped by PR. Keep the check terse: one line, no Given/When/Then. When the change classifies a set (routes, keys, types), add one coverage test that pins the count, so a new member fails CI until someone classifies it. -->
| Test | Traces | Task | Level | Gate | Check |
|---|---|---|---|---|---|
| T-RULE-1 | D-15, AC-1 | SF-2 | unit | G-merge | The contracts `merchantCategory` gives the same answer as before for every code and name case in the existing API tests. |
| T-RULE-2 | D-15, RK-6 | SF-2 | unit | G-merge | The API module's `merchantCategory`, `CODE_CATEGORIES` and `NAME_RULES` are the same objects as the contracts exports. |
| T-SUG-1 | AC-1, D-17 | SF-3 | unit | G-merge | Levels rank key, then name, then rules, then shared words, then model; the first level with a match gives the pick. |
| T-SUG-2 | AC-12, D-11, D-17 | SF-3 | unit | G-merge | One owner example beats several rule-categorized examples at the same level, and beats the current rules. |
| T-SUG-3 | AC-2, D-18 | SF-3 | unit | G-merge | Others are at most 2, distinct from the pick, never Uncategorized, filled from the owner's most used categories for the row's kind. |
| T-SUG-4 | AC-5, D-18, RK-2 | SF-3 | unit | G-merge | A row with no key, name, rule or word match gets no pick and no others. |
| T-SUG-5 | RK-4 | SF-3 | unit | G-merge | Two names sharing only stop words or tokens under 3 characters give no pick. |
| T-SUG-6 | AC-20 | SF-3 | unit | G-merge | Hostile names (markup, instructions) give the same suggestion as their plain words; nothing thrown or logged carries row text. |
| T-SUG-7 | D-9 | SF-3 | unit | G-merge | Only rows whose source is mercadopago get a suggestion. |
| T-SUG-8 | AC-11 | SF-3 | unit | G-merge | `addChoice` makes the chosen category the pick for another row with the same key or name. |
| T-SUG-9 | AC-15 | SF-3 | unit | G-merge | `suggest` over 60 rows and 600 examples finishes in under 50 ms. |
| T-SUG-10 | D-11 | SF-3 | unit | G-merge | `examplesFrom` marks a row as the owner's when it is approved or has a category override, skips Uncategorized rows and rows with neither key nor merchant. |
| T-HIST-1 | D-24, RK-3 | SF-4 | int | G-merge | History makes four 3-month reads with limit 200, at most 3 pages each, so at most 12 requests. |
| T-HIST-2 | D-24 | SF-4 | int | G-merge | One failing range gives complete false and keeps the other ranges' examples. |
| T-HIST-3 | D-24, D-26, AC-14 | SF-4 | int | G-merge | Settle's invalidations do not refetch history; unmounting removes the query; a second mount reads again. |
| T-ROW-1 | AC-10 | SF-5 | unit | G-merge | DataTable.Row passes tabIndex, key handlers, aria attributes and a ref to its row element. |
| T-MSG-1 | AC-19 | SF-5 | unit | G-merge | Every review.suggest key exists in en and es with the same arguments and plural forms; Spanish has names for Shopping, Pets, Interest, Refunds and Loans. |
| T-UI-1 | AC-1, AC-2, AC-19 | SF-6 | unit | G-merge | A row with a pick shows the pick and its others as buttons named by category, in en and in es. |
| T-UI-2 | AC-3, AC-4, D-19 | SF-6 | unit | G-merge | Tapping the pick or another chip sends one choose with that category and approved true, and the row leaves at once. |
| T-UI-3 | AC-5 | SF-6 | unit | G-merge | A payments row with no pick shows the picker and Approve as today. |
| T-UI-4 | AC-16, D-26 | SF-6 | unit | G-merge | Chips stay hidden behind a same-height placeholder until history settles; while a model can still arrive, rows with no pick keep it. |
| T-UI-5 | AC-11 | SF-6 | unit | G-merge | A choice on one row changes a similar row's pick without a reload; a refused choice takes its example back out. |
| T-KEY-1 | AC-10 | SF-7 | unit | G-merge | On a focused row, Enter accepts the pick, 1 to 3 take the chips, Up and Down move; keys inside the picker or label form are untouched. |
| T-KEY-2 | AC-10 | SF-7 | unit | G-merge | A held Enter (repeat events) saves one row only; the next row needs a keyup first. |
| T-KEY-3 | AC-10 | SF-7 | unit | G-merge | After a row leaves, focus moves to the next row, or to the heading when none is left. |
| T-SET-1 | D-27 | SF-8 | unit | G-merge | Ten quick single choices give one review refetch and one refresh, 2 s after the last settles. |
| T-SET-2 | RK-9 | SF-8 | unit | G-merge | 60 single accepts plus 12 history reads in one minute count at most 120 requests (choose calls, refetches, 2 per refresh). |
| T-POOL-1 | D-25 | SF-9 | unit | G-merge | `saveAll` never has more than 4 calls in flight. |
| T-POOL-2 | D-25, AC-8 | SF-9 | unit | G-merge | A thrown call, a rejected call and a call with no answer in 20 s each fail only their row; the others save; it resolves after all settle and never rejects. |
| T-POOL-3 | D-25 | SF-9 | unit | G-merge | A refusal with a wait of 60 s or less is retried once after the wait; a longer wait or a second refusal fails the row. |
| T-ALL-1 | AC-6 | SF-10 | unit | G-merge | The first Accept all tap shows the count and per-category tally; nothing is sent before Save. |
| T-ALL-2 | AC-7, D-19 | SF-10 | unit | G-merge | Save sends category and approval for each snapshot row and leaves rows with no pick on the list. |
| T-ALL-3 | AC-8, AC-11 | SF-10 | unit | G-merge | Failed rows come back with their suggestions, the note gives the count with plural forms, and their session examples are removed. |
| T-ALL-4 | D-25 | SF-10 | unit | G-merge | The confirmation closes on a label, a single choice or a list change; Save drops rows no longer listed; a double tap sends each row once. |
| T-ALL-5 | AC-7 | SF-10 | unit | G-merge | When every row is accepted, the saving line shows and the empty state waits for settle; focus goes to the saving line, then the heading. |
| T-ALL-6 | AC-9, RK-3 | SF-10 | unit | G-merge | 60 accepted rows plus 12 history reads against a limiter of 120 a minute give no refusal. |
| T-ALL-7 | D-24 | SF-10 | unit | G-merge | With history partial, Accept all is hidden and single chips still show. |
| T-MOD-1 | AC-17, D-12 | SF-12 | int | G-merge | On suggest-eval.json with the model, the right category is in the 3 shown for at least 80% and the pick for at least 60%; the numbers are printed. |
| T-MOD-2 | AC-17, D-23 | SF-13 | unit | G-merge | The committed model file is at most 30 MB and its SHA-384 equals MODEL_SHA384. |
| T-MOD-3 | AC-16, D-26 | SF-13 | unit | G-merge | A fetch, integrity or parse failure turns the model off with suggestions unchanged; model results only fill rows with no pick. |
| T-MOD-4 | D-22 | SF-13 | unit | G-merge | The browser tokenizer gives the same token ids as the converter for 20 synthetic names. |
| T-LH-1 | AC-18, RK-5 | SF-14 | int | G-merge | Lighthouse CI on /review: script at most 204800 bytes and layout shift at most 0.1. |

## End-to-end and manual
<!-- e2e rows and checks a person runs, in Given/When/Then. Fixtures use internal ids only; credentials never go in this folder. release.md says who runs each manual row and when. Example row: | T-E2E-1 | AC-1, D-1 | manual | manual | G-promote | Given a signed-in user, when they open a page that makes several calls, then exactly one page-view event appears. | -->
| Test | Traces | Task | Level | Gate | Check |
|---|---|---|---|---|---|
| T-E2E-1 | AC-15, RK-8 | SF-11 | e2e | none | Given the suggest test person with 60 review rows and 12 months of history, 4× CPU slowdown and 300 ms added to the data route, when /review opens, then chips show within 1 s of the list; the time is printed and the owner decides at release if it fails. |
| T-E2E-2 | AC-13, AC-14 | SF-11 | e2e | G-merge | Given the suggest test person, when /review loads and the owner accepts one chip, then every request goes to the app's own origin, no request carries a shop name, and local storage, session storage, IndexedDB and Cache Storage hold nothing new. |
| T-E2E-3 | AC-16, RK-5 | SF-11 | e2e | G-merge | Given /review with suggestions shown, when the page goes idle (and the model loads, if one shipped), then no shown chip changes and no row moves. |
| T-E2E-4 | AC-11, D-24 | SF-11 | e2e | G-merge | Given two rows for the same shop, when the owner picks a category on one, opens Overview and comes back, then the other row suggests that category. |
| T-E2E-5 | AC-6, AC-7 | SF-11 | e2e | G-merge | Given rows with suggestions, when the owner taps Accept all, then a tally shows; when they tap Save, then those rows leave and the rows with no suggestion stay. |
| T-E2E-6 | AC-19, AC-20 | SF-11 | e2e | G-merge | Given hostile review rows and Spanish, when /review shows chips, then names render as text, chips have Spanish category names, and the accessibility scan passes. |
| T-MAN-1 | RK-1, AC-1 | manual | manual | G-promote | Given qa after the merge, when the owner opens the review list, then they note how many rows have a suggestion (a count, no names) and accept a few with one tap and Accept all. |
| T-MAN-2 | AC-15 | manual | manual | G-promote | Given a mid-range phone on qa, when the owner opens the review list, then suggestions show within about 1 s. |

## Accepted, no test
<!-- Edge cases, or ACs, closed by a decision or a risk instead of a test, with a one-line reason. Name the AC id when the row covers one. Example row: | Events written before the release have no page type. | RK-1 | They expire on their own; no backfill. | -->
| Edge case | Closed by | Reason |
|---|---|---|
| A tab closed in the middle of Accept all leaves unsent rows on the list. | D-19 | Each sent row is saved whole or not at all; unsent rows wait for the next visit. |
| Rows of notes and workbook sources get no suggestion. | D-9 | The server does not take choices on them. |
| A model that misses the bar or size does not ship (AC-17's fallback). | D-7 | T-MOD-1 records the numbers; the PR ships history and rules only. |
