---
spec: category-suggestions
ticket: none
tier: L
status: executing
---
# In-browser category suggestions with one-tap approval: brief for smart-finances

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. Examples sit in these comments. -->

<!-- Fill every header line at handoff. Worktree and branch follow the convention in spec-profile.md Notes. Base is origin/ plus base_branch for smart-finances. -->
- Goal: payments rows on the review list show a suggested category and up to two others, saved and approved with one tap or with Accept all after a confirmation.
- Implements: AC-1 to AC-20; D-5, D-7 to D-12, D-15, D-17 to D-19, D-22 to D-27
- Spec folder: /Users/v/projects/smart-finances/.claude/worktrees/category-suggestions/docs/specs/category-suggestions
- Refs: smart-finances at the sha in intent.md refs; run `node ~/.claude/skills/spec/scripts/drift.mjs <spec folder>` before the first task
- Worktree: /Users/v/projects/smart-finances/.claude/worktrees/category-suggestions (it exists; data/real is already symlinked)
- Branch: feature/category-suggestions · Base: origin/qa
- Brief version: the locked-vN named in the handoff prompt (the front matter says executing once DP4 passes); record it as pr-smart-finances.md@locked-vN in progress-smart-finances.json

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Contracts, and States and exits.
4. architecture.md: the Components subsection each task names.
5. test-matrix.md: the rows whose task is yours, and the repo's CLAUDE.md or AGENTS.md if one exists.

## HUMAN needs
- <HUMAN: the owner approves downloading the upstream model files (model sentence-transformers/static-similarity-mrl-multilingual-v1 from huggingface.co: its static-embedding weights file and tokenizer.json, about 440 MB, at a revision the executor names) into ~/.cache/smart-finances/suggest-model, outside the repo, or places them there> · Blocks: SF-12
- <HUMAN: the owner merges the draft PR into qa, then runs T-MAN-1 and T-MAN-2 on qa> · Blocks: G-merge, G-promote

## Global constraints
- D-5: Roles: the agent writes code, commits, pushes the feature branch and opens a draft PR into qa; the owner reviews and merges.
- D-7: Suggestions are worked out in the browser, from the person's past rows and the existing import rules first, then a small static model with no WebAssembly, only if a measured task shows a download near 30 MB and acceptable accuracy on synthetic shop names; otherwise past rows and rules only. No transaction text leaves the browser and the script policy does not change. Supersedes D-3.
- D-8: A model file is kept only in the browser's normal download cache, with long cache rules; the app writes nothing new to browser storage.
- D-9: Every payments report row on the review list gets a suggestion, money sent and received included; notes and workbook rows do not.
- D-10: Design for 20 to 60 review rows a month.
- D-11: Suggestions learn from rows the person approved, recategorized or labelled, and from rows the import rules categorized; the person's own choices weigh more.
- D-12: The model's accuracy bar: on synthetic shop names the rules cannot place, the right category is among the 3 shown for at least 8 of 10, and is the top suggestion for at least 6 of 10.
- D-15: The payments import rules (category codes and shop name rules) move to the shared contracts package; the API module re-exports them unchanged, so the browser and the importer use one copy.
- D-17: Suggestion levels, strongest first: same recipient key, same cleaned shop name, import rules, shared words, model; within a level the owner's own rows beat rule-categorized rows.
- D-18: A row gets a suggestion only from a match on its own key or name; the other likely categories come from weaker matches, then from the owner's most used categories for that kind of row.
- D-19: One tap sends the existing review choice with the category and the approval together; no API change.
- D-22: If the model ships: a static multilingual model cut to Latin-script tokens, at most 256 dimensions, int8, as one hashed built file from the app's own address with an integrity check, loaded after idle on the review page only and run on the main thread in small chunks.
- D-23: If the model meets the bar, its converted file (at most 30 MB) is committed to the public repo with its licence notice.
- D-24: History is read again on every visit to the review page: the cached copy is dropped when the page is left. Each 3-month range is kept on its own; if one fails, suggestions use what was read and Accept all is hidden for that visit. Supersedes D-16.
- D-25: Accept all closes its confirmation on any other choice, label or list change, and Save works once. Each save is handled on its own: a refusal, an error or 20 s without an answer marks that row failed and the rest go on. It retries once after a wait of 60 s or less, shows the wait, and refetches once at the end. Supersedes D-20.
- D-26: Suggestions show only after the history read settles, in space kept for them. Rows with no suggestion keep that space until the model is ready or off. Model results only fill rows with no suggestion, and nothing outlives the page. Supersedes D-21.
- D-27: After single choices and labels, the list is refetched once, 2 s after the last one, so fast tapping stays within the request limit.
- Logs, errors and reports carry internal ids and counts only: no shop names, recipient keys, emails or row text (architecture.md Cross-cutting).
- Public repo: fixtures, stories, the evaluation set and tests use made-up shop names only (docs/specs/spec-profile.md, "Rules to honour"). Nothing from data/real enters a commit, a test or a log.
- No script policy change: apps/web/src/middleware.ts, its tests and scripts/amplify-release.mjs stay as they are. No WebAssembly, no Worker, no new runtime dependency.
- Records before code: ADR 0011 (the next free number; docs/adr/README.md rules) and docs/threat-model.md v5 (architecture.md "Records before code").
- Test commands (the profile's test.smart-finances is node --test {file}): contracts `node --test packages/contracts/test/<file>`; API `node --test apps/api/test/<file>`; scripts `node --test scripts/<file>`; web unit `npm test --workspace @smart-finances/web -- <path>` plus `npm run lint --workspace @smart-finances/web`; e2e `npm run e2e --workspace @smart-finances/web -- <spec>`; stories `npm run test-storybook --workspace @smart-finances/web`; Lighthouse `npm run lhci --workspace @smart-finances/web`. Full verify: `npm test; npm run build --workspace @smart-finances/infra`.
- Limits: 120 data requests a minute per person (5 under STAGE=test; apps/web/src/domain/limits.ts). Lighthouse on /review: script at most 204800 bytes, layout shift at most 0.1, largest paint at most 2500 ms (apps/web/lighthouserc.json).
- gh and push access are set up on this machine (spec-profile.md preflight); if a push or gh call fails, stop.

## ALWAYS / ASK FIRST / NEVER
<!-- Ticket-specific lines first. The fixed lines come from the kit's role rules; keep them. -->
**ALWAYS**
- Keep the screen working as today when history, rules or the model fail: no new error text beyond AC-8's count.
- Write the test first and see it fail. One task, one commit.
- Put the test id in the test title.
- Record each verify command and its result in progress-smart-finances.json before the next task.

**ASK FIRST**
- Downloading any file from outside the repo (the upstream model included: see HUMAN needs).
- Adding or upgrading a dependency that no decision or architecture.md Contracts names.
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
- Change the content security policy, add WebAssembly or a Worker, call an outside host from the browser, or write to browser storage.
- Commit a model file that misses the bar (T-MOD-1) or is over 30 MB.
- Merge, mark a PR ready, promote, push a protected branch, write to cloud resources, read production or enter a password.
- Edit a decision. Record a deviation in progress-smart-finances.json and stop.

## Tasks
<!-- 8 to 15 tasks. Each is one test cycle and one commit, about 150 changed lines or fewer. Fields: Implements (AC and decision ids), After, Judgment (high gets a fresh reviewer, ideally on another model), Files (by symbol), Tests first, Do (at most 5 bullets), Verify (command and expected result), Done when. Verify is the profile's test.smart-finances command with the task's test files; the full verify.smart-finances runs at the baseline and before the PR. Mark a file or symbol the task creates with (new), so drift skips it. Ids are append-only. Example task:
### SF-1 · Write one event per page view
- Implements: AC-1, D-1 · After: SF-0 · Judgment: normal
- Files: smart-finances:src/events/pageView.ts#recordPageView (new), src/events/pageView.test.ts (new)
- Tests first: T-PV-1
- Do: write the tests and see them fail; add recordPageView with the event shape from architecture.md Contracts.
- Verify: `<test.smart-finances with src/events/pageView.test.ts>` → all pass, the new tests included
- Done when: verify is green, evidence is in progress-smart-finances.json, and the reviewer has no blocker (Judgment: high only)
-->

### SF-0 · Record the baselines
- Implements: none · After: none · Judgment: normal
- Files: none (no change)
- Tests first: none
- Do:
  - The worktree and branch exist; check `git status` is clean and `git log -1` is on top of origin/qa.
  - Run `npm ci` at the worktree root first (approved: it installs the lockfile's packages; the worktree has no node_modules).
  - Run the full verify once, and `npm run lhci --workspace @smart-finances/web`, before any change.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` → each result recorded under baseline, red or green (typecheck: "in next build", the web workspace has no separate typecheck); the /review script size from Lighthouse recorded under baseline.lighthouse
- Done when: the baseline in progress-smart-finances.json is filled and the worktree is clean

### SF-1 · ADR 0011 and threat model v5
- Implements: D-7, D-22, D-23 · After: SF-0 · Judgment: normal
- Files: smart-finances:docs/adr/0011-in-browser-category-suggestions.md (new), docs/adr/README.md, docs/threat-model.md
- Files (test): apps/api/test/docs.test.mjs
- Tests first: T-DOC-11
- Do: write the ADR with Status accepted (context, the decisions above, and a "Model gate" section saying "pending SF-12", which SF-12 fills in); add it to the README index as accepted; change the threat model's status line to v5 and add the items in architecture.md "Records before code".
- Verify: `node --test apps/api/test/docs.test.mjs` → pass, T-DOC-11 included
- Done when: verify is green and the ADR names D-7, D-17, D-22 and D-23

### SF-2 · Move the payments rules to contracts
- Implements: D-15, AC-1 · After: SF-1 · Judgment: high
- Files: smart-finances:packages/contracts/src/rules.mjs#merchantCategory (new), packages/contracts/package.json, smart-finances:apps/api/src/ingest/merchants.mjs#merchantCategory, packages/contracts/test/rules.test.mjs (new), apps/api/test/merchants.test.mjs
- Tests first: T-RULE-1, T-RULE-2
- Do: architecture.md Components "Shared import rules" and Contracts "Shared rules export"; move the category check with the rules; keep the API's import path working by re-export.
- Verify: `node --test packages/contracts/test/rules.test.mjs apps/api/test/merchants.test.mjs apps/api/test/*.test.mjs` → all pass
- Done when: verify is green and the reviewer has no blocker

### SF-3 · Suggest module
- Implements: AC-1, AC-2, AC-5, AC-11, AC-12, AC-15, AC-20, D-9, D-11, D-17, D-18 · After: SF-2 · Judgment: normal
- Files: smart-finances:apps/web/src/domain/suggest.ts (new), apps/web/src/domain/suggest.test.ts (new)
- Tests first: T-SUG-1 to T-SUG-10
- Do: architecture.md Components "Suggest module" and Contracts "Suggest module"; import `merchantCategory` from `@smart-finances/contracts/rules`; declare `SuggestRow` and `HistoryRow` in the module (domain may not import screens); synthetic names only.
- Verify: `npm test --workspace @smart-finances/web -- src/domain/suggest.test.ts` and `npm run lint --workspace @smart-finances/web` → pass
- Done when: verify is green

### SF-4 · History query
- Implements: D-24, D-26, AC-14 · After: SF-3 · Judgment: normal
- Files: smart-finances:apps/web/src/queries/data.ts#useHistory (new), smart-finances:apps/web/src/queries/keys.ts#dataKeys, apps/web/src/queries/history.test.tsx (new)
- Tests first: T-HIST-1 to T-HIST-4
- Do: architecture.md Components "History read" and Contracts "History read"; return examples with `complete`, never raw rows.
- Verify: `npm test --workspace @smart-finances/web -- src/queries/history.test.tsx` and lint → pass
- Done when: verify is green

### SF-5 · Row pass-through and messages
- Implements: AC-10, AC-19 · After: SF-1 · Judgment: normal
- Files: smart-finances:apps/web/src/ui/patterns/DataTable/DataTable.tsx#DataTable, apps/web/src/ui/patterns/DataTable/DataTable.test.tsx, apps/web/src/ui/patterns/DataTable/DataTable.stories.tsx, apps/web/messages/en.json, apps/web/messages/es.json, apps/web/src/screens/review/messages.test.ts (new)
- Tests first: T-ROW-1, T-MSG-1
- Do: architecture.md Components "Review island and view" (Keyboard bullet) and Contracts "Messages" (exact en and es text, and the five category names missing from both files).
- Verify: `npm test --workspace @smart-finances/web -- src/ui/patterns/DataTable src/screens/review/messages.test.ts` and lint → pass
- Done when: verify is green

### SF-6 · Chips and one-tap save
- Implements: AC-1 to AC-5, AC-11, AC-16, AC-19, D-19, D-26 · After: SF-4, SF-5 · Judgment: normal
- Files: smart-finances:apps/web/src/screens/review/suggest/useSuggestions.ts (new), smart-finances:apps/web/src/screens/review/suggest/Chips.tsx#SuggestionChips (new), smart-finances:apps/web/src/screens/review/View.tsx#ReviewView, smart-finances:apps/web/src/screens/review/Review.tsx#Review, apps/web/src/screens/review/Review.module.css, apps/web/src/screens/review/suggest/chips.test.tsx (new)
- Tests first: T-UI-1 to T-UI-5
- Do: architecture.md Components "Review island and view" (all bullets except Keyboard and Accept all); chips 44px tall on touch screens.
- Verify: `npm test --workspace @smart-finances/web -- src/screens/review` and lint → pass
- Done when: verify is green

### SF-7 · Keyboard
- Implements: AC-10 · After: SF-6 · Judgment: normal
- Files: smart-finances:apps/web/src/screens/review/View.tsx#ReviewView, apps/web/src/screens/review/suggest/keys.test.tsx (new)
- Tests first: T-KEY-1 to T-KEY-3
- Do: architecture.md Components "Review island and view", Keyboard bullet.
- Verify: `npm test --workspace @smart-finances/web -- src/screens/review/suggest/keys.test.tsx` and lint → pass
- Done when: verify is green

### SF-8 · Debounced settle and the wait value
- Implements: D-27, RK-9 · After: SF-6 · Judgment: high
- Files: smart-finances:apps/web/src/screens/review/Review.tsx#Review, smart-finances:apps/web/src/screens/review/Review.tsx#ChooseResult, apps/web/src/screens/review/suggest/settle.test.tsx (new)
- Tests first: T-SET-1, T-SET-2
- Do: architecture.md Components "Review island and view" (settle bullet) and Contracts "Choose with category and approval"; keep the "only the last in flight refetches" guard; labels keep their 5 s totals refetch.
- Verify: `npm test --workspace @smart-finances/web -- src/screens/review` and lint → pass
- Done when: verify is green and the reviewer has no blocker

### SF-9 · Save pool
- Implements: D-25, AC-8 · After: SF-1 · Judgment: high
- Files: smart-finances:apps/web/src/screens/review/suggest/pool.ts#saveAll (new), apps/web/src/screens/review/suggest/pool.test.ts (new)
- Tests first: T-POOL-1 to T-POOL-3
- Do: architecture.md Contracts "Save pool" and Components "Review island and view", Accept all runner bullets; fake timers for the 20 s and retry waits; errors carry ids and counts only.
- Verify: `npm test --workspace @smart-finances/web -- src/screens/review/suggest/pool.test.ts` and lint → pass
- Done when: verify is green and the reviewer has no blocker

### SF-10 · Accept all
- Implements: AC-6 to AC-9, AC-11, D-24, D-25 · After: SF-8, SF-9 · Judgment: high
- Files: smart-finances:apps/web/src/screens/review/suggest/AcceptAll.tsx#AcceptAll (new), smart-finances:apps/web/src/screens/review/model.ts#applyChoices (new), smart-finances:apps/web/src/screens/review/Review.tsx#Review, apps/web/src/screens/review/suggest/accept-all.test.tsx (new)
- Tests first: T-ALL-1 to T-ALL-7
- Do: architecture.md Components "Review island and view" (Accept all and Accept all runner bullets) and States and exits rows Confirming, Saving, Done, Partial.
- Verify: `npm test --workspace @smart-finances/web -- src/screens/review` and lint → pass
- Done when: verify is green and the reviewer has no blocker

### SF-11 · Stories, test person and e2e
- Implements: AC-6, AC-7, AC-11, AC-13 to AC-16, AC-19, AC-20 · After: SF-10 · Judgment: normal
- Files: apps/web/src/screens/review/Review.stories.tsx, smart-finances:apps/web/src/adapters/container.ts#E2E_PEOPLE, smart-finances:apps/web/src/adapters/memory/data-api.ts#fixtureSeed, apps/web/fixtures/suggest.json (new), apps/web/e2e/suggest.spec.ts (new), and any existing e2e spec under apps/web/e2e that opens /review (a11y, hostile, limit, overview, review-rates, shell) where its person's data mode changes
- Tests first: T-E2E-1 to T-E2E-6
- Do: architecture.md Cross-cutting "Tests and the test-stage limit" and the stories bullet in "Review island and view"; change test expectations only where a person's data mode changed, never to hide a failure.
- Verify: `npm run e2e --workspace @smart-finances/web` (the whole suite) and `npm run test-storybook --workspace @smart-finances/web` → pass (T-E2E-1 prints its time; a miss is recorded, not a failure)
- Done when: verify is green

### SF-12 · Model gate: evaluation and converter
- Implements: AC-17, D-12, D-22 · After: SF-3 and the SF-12 HUMAN need · Judgment: high
- Files: apps/web/fixtures/suggest-eval.json (new), smart-finances:apps/web/src/domain/suggest-model.ts (new), scripts/suggest-model.mjs (new), scripts/suggest-model.test.mjs (new), apps/web/src/domain/suggest-model.eval.test.ts (new), package.json (root test script), docs/adr/0011-in-browser-category-suggestions.md
- Tests first: T-MOD-1
- Do:
  - First, read the model's current revision: `curl -s https://huggingface.co/api/models/sentence-transformers/static-similarity-mrl-multilingual-v1` (its `sha` and `siblings`). Tell the owner the revision, the two file names (the static-embedding weights and tokenizer.json) and their sizes, and wait for the HUMAN need above. Pin that revision in the converter.
  - Commit the evaluation set first, alone (this task is two commits): at least 30 synthetic names that `merchantCategory` misses, plus at least 40 synthetic history examples (architecture.md Components "Static model").
  - Write the converter (Contracts "Model file"); it reads the files under ~/.cache/smart-finances/suggest-model and writes its output there, never into the repo. The tokenizer, embedding and scorer live in apps/web/src/domain/suggest-model.ts (new; add it to Files), used by the eval test and later by the SF-13 loader; the converter keeps a reference tokenizer only for T-MOD-4's expected ids. Its own test uses a tiny synthetic table, no downloaded file; add it to the root `npm test` list.
  - The eval test skips (not fails) when the downloaded files are absent; it reads D from `SUGGEST_DIMS`. Run T-MOD-1 for D = 64, 128, 256; record each size and score in progress and in the ADR's "Model gate" section.
  - Pass (bar met at a size of 30 MB or less): continue to SF-13 with the smallest passing D. Miss: record the numbers in the ADR and progress, skip SF-13, and keep the converter and evaluation set without any model file.
- Verify: `node --test scripts/suggest-model.test.mjs` and `npm test --workspace @smart-finances/web -- src/domain/suggest-model.eval.test.ts` → pass, scores printed
- Done when: verify is green, the outcome is in progress and the ADR, and the reviewer has no blocker

### SF-13 · Model loader (only if SF-12 passed)
- Implements: AC-16, AC-17, D-22, D-23, D-26 · After: SF-12, SF-11 · Judgment: normal
- Files: apps/web/next.config.ts (only if the build does not emit the file from `new URL(..., import.meta.url)` on its own), smart-finances:apps/web/src/screens/review/suggest/model.ts#loadModel (new), smart-finances:apps/web/src/screens/review/suggest/model.ts#MODEL_SHA384 (new), apps/web/src/screens/review/suggest/suggest-model.bin (new), apps/web/src/screens/review/suggest/NOTICE-suggest-model.txt (new), apps/web/src/screens/review/suggest/model.test.ts (new)
- Tests first: T-MOD-2 to T-MOD-4
- Do: architecture.md Components "Static model" and Contracts "Model file"; dynamic import from the island; run `npm run build --workspace @smart-finances/web` and record the size of .next/static/media and of the build output.
- Verify: `npm test --workspace @smart-finances/web -- src/screens/review/suggest/model.test.ts` and `npm run e2e --workspace @smart-finances/web -- e2e/suggest.spec.ts` → pass
- Done when: verify is green and the build sizes are in progress

### SF-14 · Full verify, Lighthouse and draft PR
- Implements: AC-18 · After: every earlier task (SF-13 skipped when the model missed) · Judgment: normal
- Files: none beyond fixes inside earlier tasks' files
- Tests first: T-LH-1
- Do: run the full verify and Lighthouse (T-LH-1 is that run; record its numbers); start a fresh read-only reviewer for the conformance review (the spec-reviewer agent, given this brief, test-matrix.md and the diff against origin/qa) and log it in review.md Conformance review; fix or record its findings; push the branch; `gh pr create --draft --base qa --head feature/category-suggestions` with the PR body below, then reread the body against "PR body" yourself.
- Verify: `npm test; npm run build --workspace @smart-finances/infra` and `npm run lhci --workspace @smart-finances/web` → pass
- Done when: the draft PR is open and its body is checked

## Stop and hand back when
<!-- Add ticket-specific stop points. At a stop: write the hand-back report and wait. -->
- A task would deviate from a decision. Record the deviation first.
- A value this brief needs is missing.
- Verify is still red after 2 fix rounds.
- A change is needed outside the task's Files.
- Credentials or production access are needed.
- The next step is a push to a protected branch, marking a PR ready, or a merge.
- The draft PR is open and its body is checked.
- SF-12 needs the model download and the owner has not approved it.
- T-MOD-1 misses the bar: record it and go on without SF-13; never tune the evaluation set after seeing scores.

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
No PR template: list changes per task id, test ids with results, the T-MOD-1 scores and model file size (or "model not shipped"), the T-E2E-1 time, the Lighthouse script size before and after, deviations, and the HUMAN steps left (T-MAN-1, T-MAN-2).
