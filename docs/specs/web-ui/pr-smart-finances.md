---
spec: web-ui
ticket: none
tier: M
status: draft
---
# Web UI: design system and screens: brief for smart-finances

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. Examples sit in these comments. -->

<!-- Fill every header line at handoff. Worktree and branch follow the convention in spec-profile.md Notes. Base is origin/ plus base_branch for smart-finances. -->
- Goal: <!-- one sentence: what this PR delivers for the user -->
- Implements: <!-- the AC and decision ids, e.g. AC-1, D-1 -->
- Spec folder: <!-- absolute path; read and write the spec here, never a copy in the worktree -->
- Refs: smart-finances at the sha in intent.md refs; run drift.mjs before the first task
- Worktree: <!-- absolute path -->
- Branch: <!-- branch name --> · Base: <!-- origin/base_branch -->
- Brief version: the locked-vN named in the handoff prompt (the front matter says executing once DP4 passes); record it as pr-smart-finances.md@locked-vN in progress-smart-finances.json

## Read first
<!-- At most 5 items, in order, naming exact sections. Anything not listed is background the executor does not need. -->
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Contracts, plus the sections your tasks cite.
4. The repo's own rules file (CLAUDE.md or AGENTS.md) in the worktree.
5. L tier: the test-matrix.md rows whose task starts with SF.

## HUMAN needs
<!-- Values and actions only a person can supply that block this PR's tasks, copied from release.md (L) or intake, one per line: - <HUMAN: what is needed> · Blocks: <task id or gate>. Ask for them at the start; never invent them. The commit, push and draft-PR permission is a decision, not a HUMAN need: copy its line under Global constraints. -->
- <HUMAN: refine the prototype in Claude Design and hand off the design system and screens (D-4)> · Blocks: the build tasks
- <HUMAN: merge the data-foundation PR into qa and create the owner and second test user in the qa pool> · Blocks: checks against qa
- <HUMAN: the web address for staging and prod, for the allowed-origins list> · Blocks: the infra task for allowed web addresses
- <HUMAN: check in the Vercel dashboard whether main or staging still deploy the old app> · Blocks: the hosting task (D-45)
- <HUMAN: walk one first sign-in on qa with a test user (new password, authenticator setup) and note which token the API accepts> · Blocks: the sign-in task
- <HUMAN: point the hosting project root at apps/web and turn Git deploys back on> · Blocks: first preview deploy

## Global constraints
<!-- Copied verbatim, so the executor never opens another file for them: decision one-liners (id: text), the permission decision included; project rules this change touches; exact values; limits from intake. Example: - D-1: Record page views as a new event type in the existing event log. Never paraphrase; if a value changes, the brief gets a new version. -->
- Logs, errors and reports carry internal ids and counts only: no names, emails, IPs or file keys.

## ALWAYS / ASK FIRST / NEVER
<!-- Ticket-specific lines first. The fixed lines come from the kit's role rules; keep them. -->
**ALWAYS**
- Write the test first and see it fail. One task, one commit.
- Put the test id in the test title.
- Record each verify command and its result in progress-smart-finances.json before the next task.

**ASK FIRST**
- Adding or upgrading a dependency that no decision or architecture.md Contracts names.
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
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
  - Create the worktree and branch from the header.
  - Run every verify command once, before any change.
- Verify: <!-- paste verify.smart-finances from spec-profile.md --> → each result recorded under baseline, red or green
- Done when: the baseline in progress-smart-finances.json is filled and the worktree is clean

## Tests
<!-- M tier only: this table is the home of this PR's test ids, written at handoff. Row: id, traces, task (a task id or manual), level, gate, check, as in test-matrix.md. L tier: delete this section; the rows live in test-matrix.md. Example row: | T-PV-1 | AC-1, D-1 | SF-1 | unit | G-merge | Two calls in one page open write one event. | -->
| Test | Traces | Task | Level | Gate | Check |
|---|---|---|---|---|---|

## Stop and hand back when
<!-- Add ticket-specific stop points. At a stop: write the hand-back report and wait. -->
- A task would deviate from a decision. Record the deviation first.
- A value this brief needs is missing.
- Verify is still red after 2 fix rounds.
- A change is needed outside the task's Files.
- Credentials or production access are needed.
- The next step is a push to a protected branch, marking a PR ready, or a merge.
- The draft PR is open and its body is checked.

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
