---
spec: category-suggestions
ticket: none
tier: L
status: locked-v2
---
# In-browser category suggestions with one-tap approval: review

<!-- Tables only. Scripts check what can be checked; reviewers judge the rest. No numeric scores and no self-grading: every reviewer is a fresh context, ideally on a different model. M tier adds this file with new-spec.mjs --add review.md when it first needs it. Examples sit in these comments. -->

## Lens review
<!-- At G-design. One fresh reviewer per lens: security and data; contract and deploy; pre-mortem (states and exits); frontend when there is a web or app UI PR. Reviewers report only correctness or requirement gaps, with evidence. Rows have no ids; cite the AC or decision a finding touches. Severity: blocker, major or minor. Disposition: accepted (what changed, where) or rejected (why, with evidence). Example row: | contract and deploy | major | Reads would still write an event per call if the old logger stays on. | D-1 | architecture.md Components | accepted: the logger skips reads; a test checks it | -->
| Lens | Severity | Finding | Cites | Evidence | Disposition |
|---|---|---|---|---|---|
| security and data | major | Cached history outlives the page while session choices are lost, so a return visit suggests from stale history. | AC-11, AC-12, D-16, D-21, AC-7 | architecture.md 'History read (D-16)': key ['data','history'], 'staleTime: Infinity', 'never re-read after a save'. 'Review island': useSuggestions 'keeps th… | accepted: gcTime 0 and removal on unmount (architecture.md History read; D-24); an e2e step chooses, leaves, returns and expects the owner's category |
| security and data | major | Accept all has no handling for a choose call that rejects. | AC-8, D-20 | architecture.md 'Accept all runner': 'mutationFn calls choose for each row, 4 at a time ... The function returns the ids that failed.' States 'Saving': 'any … | accepted: each call wrapped, rejection marks the row failed, pool goes on (Review island, Accept all runner; D-25); unit test with rejecting calls |
| contract and deploy | major | Accept all has no handling for a thrown or hung choose call; rows vanish with no count. | AC-8, D-20 | architecture.md:71 says 'mutationFn calls choose for each row, 4 at a time... The function returns the ids that failed'. architecture.md:167 says 'any other … | accepted: wrapped calls, 20 s timeout, all settled, mutationFn never rejects (Accept all runner; D-25); unit test with throwing calls |
| contract and deploy | major | Cached history outlives the page, contradicting D-21. | D-21, D-16, AC-11, AC-12 | architecture.md:37 sets 'staleTime: Infinity, retry: 1, and no refetch on focus or reconnect', with no gcTime. QueryProvider wraps every money page at apps/w… | accepted: as above (D-24); a test that a second mount reads history again |
| contract and deploy | major | E2E tests for chips and timing run under the test stage's 5 requests a minute; history would be refused. | AC-15, AC-16, RK-5, RK-8 | apps/web/src/domain/limits.ts:35: personLimit returns 5 when stage is 'test'. apps/web/src/adapters/container.ts:170 notes that 'one overview first view alon… | accepted: a new uncounted E2E person with 60 review rows and 12 months of history (Cross-cutting, Tests); Lighthouse fixtures must render chips |
| contract and deploy | major | The model digest has no named home and no check against the committed file. | AC-16, AC-17, D-22 | architecture.md:87 says 'The integrity value comes from the converter.' Contracts 'Model file' (architecture.md:131) says 'The converter prints its SHA-384 d… | accepted: file, NOTICE and MODEL_SHA384 named in Contracts, Model file; a unit test hashes the file and checks the size |
| pre-mortem | major | Fast single accepts each run a full settle and reach 120 requests a minute. | AC-3, AC-4, AC-10, D-19, RK-3 | settle() invalidates review and totals and calls router.refresh() (apps/web/src/screens/review/Review.tsx:87-93). The refresh re-runs readReview in the layou… | accepted: debounced settle for single choices (Review island; D-27); RK-9 with a 60-single-accepts test at a limiter of 120 |
| pre-mortem | major | Stale cached history after navigating away and back. | AC-11, AC-12, D-16, D-21 | 'staleTime: Infinity, retry: 1, and no refetch on focus or reconnect' (architecture.md:37). There is one QueryClient per tab inside the (app) layout (apps/we… | accepted: same fix as the cache finding above (D-24) |
| pre-mortem | major | A failed history range silently drops to rules, and Accept all can then save rule categories over the owner's past choices. | AC-12, AC-7, D-16, D-17 | 'A read fails after 1 retry → History failed: suggestions use rules and model only, no message' (architecture.md:161). The query returns the merged examples,… | accepted: ranges kept separately; a failed range hides Accept all for the visit; the cap keeps the newest rows and counts as read (History read, States; D-24) |
| pre-mortem | major | E2E tests cannot get enough request budget under the test stage. | AC-7, AC-8, AC-9, AC-15, AC-16, RK-5, RK-8 | 'const personLimit = (stage: Stage) => (stage === 'test' ? 5 : 120);' (apps/web/src/domain/limits.ts:35). 'a person may make 5 data reads a minute under STAG… | accepted: same fix as the test-stage finding above |
| pre-mortem | major | A thrown choose call in Accept all is unhandled; settle may run while saves continue. | AC-8, D-20 | 'mutationFn calls choose for each row, 4 at a time. A result with retryAfterSeconds of 60 or less is retried once... The function returns the ids that failed… | accepted: same fix as the thrown-call finding above (D-25) |
| pre-mortem | major | A label made during the confirmation is overwritten by Save. | AC-6, AC-7, D-20 | 'Confirming / Accept all tapped / Save → Saving; Cancel or a single choice elsewhere → closed' (architecture.md:166). Labels are disabled only 'while it runs… | accepted: confirmation closes on any choice, label or list change; Save drops rows no longer listed (Accept all; D-25); unit test for a label during Confirming |
| pre-mortem | major | Holding Enter approves a run of rows. | AC-10, AC-6 | 'On the row element only, Enter is the pick... When a row leaves the list, focus moves to the next row' (architecture.md:64). No-go: 'No undo after a save' (… | accepted: repeat events ignored and a keyup needed before the next accept (Keyboard); unit test for repeated Enter |
| frontend | major | Model chips arriving after history push rows down. | AC-16, D-21, RK-5 | architecture.md:62 'Until then, payments rows keep the chip area's height as an empty, aria-hidden placeholder'. After history settles, nothing keeps space i… | accepted: placeholder kept in rows with no pick until the model is ready or off (Review island; D-26); RK-5 e2e test extended |
| frontend | major | A label made during the confirmation is overwritten by Save. | AC-6, AC-7, D-20, D-11 | architecture.md:166 Confirming exits on 'Save → Saving; Cancel or a single choice elsewhere → closed'. architecture.md:74 disables label buttons only 'while … | accepted: same fix as the label finding above (D-25) |
| frontend | major | Accepting every row shows the empty state while saves still run. | AC-7, AC-8, D-20 | architecture.md:70 'onMutate applies every snapshot choice at once'. Review.tsx:102 returns the empty StateBlock when items.length === 0, before ReviewView o… | accepted: the saving line renders before the empty-state branch; empty state only after settle (Accept all runner); test that accepts every row |
| frontend | major | The design does not cite the web-ui target size and Storybook rules. | AC-10, AC-19 | docs/specs/web-ui/decisions.md decision 22: 'Click targets are at least 32px, and 44px on touch screens'. web-ui decision 129: 'Storybook documents ... every screen state in both… | accepted: the web-ui spec's decisions 22, 129, 136 and 141 cited; stories listed for each state in en and es (Review island) |
| security and data | minor | A double tap on Save can start the run twice. | AC-6, AC-9, D-20 | architecture.md 'Accept all runner': 'The single-choice and label buttons are disabled while it runs' (Save is not listed). States: 'Confirming / ... / Save … | accepted: Save is single-shot (Accept all; D-25); unit test that two taps send each row once |
| security and data | minor | Errors from the new code could carry row text to browser monitoring. | AC-13 | apps/web/src/app/rum.tsx rumOptions: "telemetries: ['errors', 'performance']". architecture.md Cross-cutting 'Personal data and logs' only says 'No new log l… | accepted: errors carry ids and counts only (Review island, Cross-cutting); unit test with hostile rows |
| security and data | minor | Feature door is 2-way while D-23 is a one-way door the owner has not signed. | D-23, D-13, D-14 | intent.md front matter 'door: 2-way'. decisions.md D-23 '/ 1-way / design, 2026-11-15 / proposed /'. D-13: 'the owner approved AC-1 to AC-20 and the no-gos'. | deferred to DP3: the owner signs D-23; if option B is chosen, intent.md's door becomes 1-way |
| pre-mortem | minor | Saving has no visible progress during a retry wait of up to 60 s. | AC-8, D-20 | 'A result with retryAfterSeconds of 60 or less is retried once after that wait' and 'The single-choice and label buttons are disabled while it runs' (archite… | accepted: the saving line shows the seconds left during a wait (Accept all runner) |
| pre-mortem | minor | Failed Accept all rows stay in the index as owner choices. | AC-11, D-11 | useSuggestions 'adds each saved or optimistic choice'; 'A refused single choice also removes its session example' (architecture.md:59-61). | accepted: failed Accept all rows lose their session example (Review island) |
| frontend | minor | DataTable.Row takes no tabIndex, key handlers or ref. | AC-10 | apps/web/src/ui/patterns/DataTable/DataTable.tsx Row({ selected, children }) renders a bare <tr>. architecture.md:64 'On the row element only, Enter is the p… | accepted: DataTable.Row passes through the props and ref, with its own test and story (Keyboard) |
| frontend | minor | No focus target after Save or Cancel. | AC-10, AC-6 | architecture.md:64 sets focus only 'When a row leaves the list'. AcceptAll renders only 'when at least one row has a pick' (:65). The page has a focusable h1… | accepted: focus targets after Save, Cancel and an empty end (Accept all) |
| frontend | minor | Count messages lack plural forms and the glossary term Accept all. | AC-19, AC-6, AC-8 | architecture.md:134 acceptAll ('Accept {n} suggestions'), someFailed ('{n} didn't save...'). The project uses ICU plurals, e.g. messages/en.json:71 '{n, plur… | accepted: ICU plurals and the visible label 'Accept all' (Contracts, Messages) |
| frontend | minor | Failed Accept all rows stay in the index as owner choices. | AC-11, AC-8 | architecture.md:61 'A refused single choice also removes its session example (AC-11).' The Accept all runner (:69-74) undoes failed ids in the list but not i… | accepted: same fix as the finding above |

## Cold-read log
<!-- At G-handoff, one run per brief and round: a fresh context on a cheaper or different model gets only intent.md, the brief and the sections it cites (tier S: spec.md). Model class is cheaper, different, or same in a fresh context; never a model name. Gate: zero cannot-start items. -->
| Brief | Round | Date | Model class | Cannot start | Missing values | Assumptions | Fixed in |
|---|---|---|---|---|---|---|---|
| pr-smart-finances.md | 1 | 2026-11-15 | same, fresh context | 2 | 12 | 16 | SF-0 `npm ci`; SF-11 test person mode, fixture seeding and the rule for existing /review people (architecture.md Cross-cutting); T-DOC-11; T-HIST-4 with the no-payments-row rule; Messages wording table; SuggestRow and Save pool contracts; SF-12 revision steps; SF-14 conformance steps; lighthouse baseline field. Accepted as written: SF-4 ranges from the browser clock, SF-7 shortcut value, the loader task's webpack asset emit (next.config.ts now in Files). |
| pr-smart-finances.md | 2 | 2026-11-15 | same, fresh context | 0 | 5 | 17 | Model scorer values and minimum score, one scorer home (architecture.md "Static model"); useHistory return shape; fixture rows may carry review fields; test id T-DOC-11 (the first docs id is taken by an earlier spec); SF-14 after every task. The locked version and the HUMAN needs are expected. Accepted as written: SF-0 commits the progress file; tasks run in id order. |

## Conformance review
<!-- Before each draft PR: a fresh reviewer compares the diff with the brief and its test ids. A finding that needs a decision becomes a deviation, not an edit. -->
| Brief | Date | Tasks matched | Test ids found | Off-brief changes | Verdict |
|---|---|---|---|---|---|

## Outcome
<!-- At G-close. One line per AC: pass, fail or partial, and where it was verified, for example: - AC-1: pass, T-E2E-1 on production. Then the merge sha per repo. -->

## Defects
<!-- Every defect found after G-handoff. Origin: spec-gap (the spec was silent), spec-wrong (the spec was wrong), executor (the brief was right, the code was not), env (tools, access, CI). -->
| Defect | Origin | Found at | Fixed in | Kit change |
|---|---|---|---|---|

## Metrics
| Metric | Value |
|---|---|
| Decision point minutes (DP1, DP2, DP3, DP4) | |
| Decision rounds after G-design | |
| Lens findings, and the share rejected (%) | |
| Cold-read cannot-start items, per round | |
| Deviations | |
| Folder tokens; executor required reading (status.mjs) | |

## Kit changes
<!-- Each recurring issue becomes a lint rule or a template change in agent-kit. One line each, naming the defect or metric behind it. -->
