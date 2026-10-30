---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: brief for smart-finances (PR 3 of 4, auth)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. -->

- Goal: people can sign up, confirm, set up an authenticator, sign in, reset and sign out, with server-held sessions, limits and consent.
- Implements: AC-1, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-19, AC-20, D-72, D-73, D-75, D-87, D-91, D-92, D-103, D-106, D-108, D-115, D-117, D-120
- Spec folder: /home/user/smart-finances/docs/specs/web-ui in a cloud session; locally <repo root>/docs/specs/web-ui. Read and write the spec there, on the branch named under Branch, never a copy elsewhere.
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git fetch origin qa feature/web-ui`, then `node ~/.claude/skills/spec/scripts/drift.mjs docs/specs/web-ui --strict` (exit 0; NEW lines are expected)
- Worktree: a cloud session's own checkout; locally <repo root>/.claude/worktrees/web-auth (profile Notes)
- Profile verify (full, at the baseline and before the PR): `npm test` and `npm run build --workspace @smart-finances/infra`. No separate lint or typecheck exists; record "none".
- Every task may also touch, without stopping: apps/web/package.json and package-lock.json (for packages this brief allows), apps/web/src/i18n/en.ts and es.ts (new keys only, both files), and its own *.module.css files.
- Judgment: high tasks get a fresh-context reviewer before done: a subagent or fresh chat given the task, its diff and the review prompt in ~/.claude/skills/spec/references/handoff-prompts.md.
- Branch: feature/web-auth · Base: origin/feature/web-ui, after the previous PR is merged into it · Draft PR into feature/web-ui (D-121)
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances-auth.md@locked-vN in progress-smart-finances-auth.json
- Order: PR 3 of 4.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "Auth flows (web server)", "Sessions and accounts"; Contracts "Interfaces between the PRs", "Cookies", "Sessions table", "Accounts table", "Limits", "Password and code rules", "Security events", "Web server settings"; "States and exits" rows sign-up to reset confirm.
4. CLAUDE.md in the worktree.
5. test-matrix.md rows whose task is SF-141 to SF-153.

## HUMAN needs
- <HUMAN: support-address and signup-open (true on qa) stage parameters> · Blocks: the qa check after merge
- <HUMAN: walk sign-up, setup, sign-in, reset and sign out on the qa branch with a test address> · Blocks: G-merge of feature/web-ui into qa
- <HUMAN: review the privacy and terms text> · Blocks: SF-152 done

## Global constraints
- D-6: Roles: the agent writes code, commits, pushes feature branches and opens draft PRs into qa; the user reviews, merges and promotes. Source: data-architecture spec D-4 (default).
- D-11: Language: English and Spanish, switchable. Spanish addresses people with tú.
- D-72: Sessions: an opaque id in a __Host- cookie keys a server-side row holding the tokens; idle 30 minutes, absolute 12 hours, new id at sign-in; sign out revokes. A reload keeps you in; the session ends with the browser, not the tab. Supersedes D-47. Details: architecture.md, Contracts.
- D-73: Sign-in from the web server with a new confidential client (secret, password flow, context data); the server answers each challenge; the secret is read at run time by the compute role; the public client goes once this works on qa. Packages: AWS SDK clients for Cognito, DynamoDB and Secrets Manager, and qrcode.
- D-75: Authentication follows OWASP ASVS 5.0 V6 and V7 and the OWASP cheat sheets; the rules are in architecture.md, Contracts, "Password and code rules", and in Auth flows.
- D-87: Consent lives in an accounts table keyed by the person: terms and privacy versions, language and time, from the pre-auth state, written at the first completed sign-in; money screens wait until it exists. Erase-all keeps it; delete account removes it. Supersedes D-78.
- D-91: Pre-auth state: a server-side row keyed by a separate __Host-pre cookie (SameSite=Strict) holds the step, the sign-in service's challenge session, the new key during setup and the accepted versions, for 15 minutes; the client's challenge session lasts 15 minutes; an expired challenge returns to the password step.
- D-92: After a password reset, the web server signs the person out everywhere (admin global sign-out on this pool) and removes their session rows. The compute role may do that and get or delete users on this pool only.
- D-103: Lost authenticator: the code and reset screens link to a page with the stage's support address (a role address, a stage parameter) and what the owner asks to confirm identity.
- D-104: Delete account, final: first a full re-sign-in (password and code) and no running import; then mark deleting; that session alone may reach the finish route; erase, global sign-out, delete the pool user, remove rows. The hourly job finishes a stuck deletion by invoking the data service's delete function with the sub (one function, one grant; a follow-up row in the data-architecture spec) and alarms after 6 hours. Supersedes D-97.
- D-106: Unconfirmed sign-ups: a new sign-up for an unconfirmed email deletes the old one and starts again with the new password; code emails per email are capped at 3 an hour and 10 a day, with the same reply either way; the hourly job alone may list users to remove unconfirmed ones after 24 hours. Supersedes D-99.
- D-108: Middleware does only the nonce, the content policy and a cookie-presence redirect; the session, consent and deleting checks run in a server-only helper called by the money layout and every route handler.
- D-110: Web server settings: one contract table (architecture.md); the branch-variables custom resource merges into Amplify's map without dropping keys; amplify.yml writes the listed names and the commit id into .env.production before the build.
- D-115: Security baseline: OWASP ASVS 5.0 level 2. The Origin must equal the stage's web address from the settings; a missing or null Origin is refused; sign-out is a post; counter keys are an HMAC of the email or address prefix. A notice email goes out after a password reset or an authenticator reset. Lost-authenticator recovery asks a reply from the account email plus details only the person knows, waits 72 hours, then signs out everywhere. Narrows D-75 and D-103.
- D-117: No paid Cognito plan: the pool stays on Lite with no threat protection; the web server refuses breached passwords at sign-up and reset through the free Pwned Passwords range API (only the first 5 characters of the password's SHA-1 leave the server; if the API is down, the password is accepted and the miss logged); no context data is sent. Supersedes D-94 and narrows D-73.
- D-118: qa is open to anyone: signup-open is true on qa, with no allow-list. The user accepts strangers' data on qa before the legal answer, on a stage whose data may be wiped; the privacy notice says qa is a test stage. Staging and prod stay closed until Q-8. Narrows D-98 and D-109.
- D-120: No WAF for now, on any stage. Limits live in the web server's window counters: auth posts per IP 20 per 5 minutes, sign-in or reset failures per email and address prefix 5 per 15 minutes, code emails per email 3 an hour and 10 a day, data requests per person 120 a minute. A self-hosted proof-of-work check (served from the site, no third party) guards sign-up and the auth posts instead of the WAF challenge. The user accepts that floods reach the web server's compute. Supersedes D-90 and D-105.
- D-121: Integration branch: the four PRs (foundation, infra, auth, screens) each open as a draft into feature/web-ui, in order; once all are merged there, one PR from feature/web-ui into qa ships infra and web in one merge. The agent commits, pushes its feature branches and opens draft PRs; the user reviews, merges and promotes. Narrows D-6.
- D-122: Until SES is set up (D-77), the notice after a password or authenticator reset is shown on the next sign-in screen and logged as a security event, not emailed; the email is added with SES before staging and prod open sign-up. Narrows D-115.
- Values:
  - Packages allowed: @aws-sdk/client-ssm, @aws-sdk/client-cognito-identity-provider, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, @aws-sdk/client-secrets-manager, qrcode.
  - Secret hash: base64(HMAC-SHA256(client secret, username + client id)). Username is the email, lower-cased.
  - Timing: auth replies for known and unknown emails take the same time (pad to 800 ms).
  - Web tests: `npm test --workspace @smart-finances/web -- <file>`; browser tests: `npm run e2e --workspace @smart-finances/web -- <file>`.
- Rules: README.md "Layout" (only data/synthetic is committed); .gitignore block "Real financial data stays local"; docs/adr/README.md (one ADR per decision, NNNN-short-title.md); docs/threat-model.md (update when a trust boundary or data store changes); public repo: no personal data or account ids in anything committed.

## ALWAYS / ASK FIRST / NEVER
**ALWAYS**
- Write the test first and see it fail. One task, one commit.
- Put the test id in the test title.
- Record each verify command and its result in progress-smart-finances-auth.json before the next task.
- Use synthetic data only (data/synthetic). No personal data, names, account ids or real figures in code, tests, fixtures, logs or commits.

**ASK FIRST**
- Adding or upgrading a dependency that no decision or this brief's Values names.
- Any command with side effects outside the worktree and the spec folder.

**NEVER**
- Merge, mark a PR ready, promote, push a protected branch, write to cloud resources, read production or enter a password.
- Edit a decision, intent.md, decisions.md or this brief. Record a deviation in progress-smart-finances-auth.json and stop.
- Log or store a password, code, token, secret, email or IP outside the places architecture.md Contracts allows.

## Tasks
### SF-140 · Record the baselines
- Implements: none · After: none · Judgment: normal
- Files: none (no change)
- Tests first: none
- Do:
  - Create the branch from the header off origin/feature/web-ui.
  - Run `npm ci`, then `npm test` and `npm run build --workspace @smart-finances/infra` (the profile's verify), plus the web workspace's tests once it exists.
  - Run drift as the header says.
- Verify: the profile's verify.smart-finances → each result recorded under baseline, red or green
- Done when: verify is green, evidence is in progress-smart-finances-auth.json
### SF-141 · Load the settings and secrets, and add a safe logger
- Implements: AC-16, D-110, D-80, D-115 · After: SF-140 · Judgment: high
- Files: apps/web/src/server/settings.ts (new), apps/web/src/server/log.ts (new), apps/web/src/server/aws.ts (new), apps/web/src/server/fakes/ (new), apps/web/src/server/server.test.ts (new)
- Tests first: T-WAUTH-1, T-WAUTH-2
- Do:
  - settings.ts reads the names in Contracts "Web server settings"; secrets through Secrets Manager with the compute role, cached 5 minutes.
  - log.ts writes one JSON security event per line; it throws on keys named password, code, secret, token, email or ip.
  - aws.ts returns real clients, or in-memory fakes when STAGE=test: tables with conditional updates and TTL fields, a secrets store, and a sign-in service fake that later tasks extend. Secrets are plain strings.
- Verify: `npm test --workspace @smart-finances/web -- src/server/server.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-142 · Store sessions and pre-auth rows
- Implements: AC-16, AC-15, D-72, D-91 · After: SF-141 · Judgment: high
- Files: apps/web/src/server/session.ts (new), apps/web/src/server/session.test.ts (new)
- Tests first: T-WAUTH-3, T-WAUTH-4
- Do:
  - Cookies and rows exactly as Contracts "Cookies" and "Sessions table"; keys are SHA-256 of the cookie id.
  - Every read checks expires_at and last_seen_at (idle 30 minutes, absolute 12 hours); refresh when the access token has under 5 minutes.
  - Sign out: delete the row, revoke the refresh token; signOutEverywhere(sub) uses the sub index and AdminUserGlobalSignOut.
- Verify: `npm test --workspace @smart-finances/web -- src/server/session.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-143 · Add window counters with HMAC keys
- Implements: AC-17, D-120, D-115 · After: SF-142 · Judgment: high
- Files: apps/web/src/server/limits.ts (new), apps/web/src/server/limits.test.ts (new)
- Tests first: T-WAUTH-5
- Do:
  - Atomic counter per scope and window start (window start = floor(now / window) * window), values per Contracts "Limits"; keys HMAC of the email or address prefix (IPv4 /24, IPv6 /48) or the sub. In STAGE=test the person limit is 5 a minute.
  - Client IP: the right-most X-Forwarded-For entry.
- Verify: `npm test --workspace @smart-finances/web -- src/server/limits.test.ts` → pass, window edges included
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-144 · Add the proof-of-work check
- Implements: AC-19, D-120 · After: SF-143 · Judgment: high
- Files: apps/web/src/server/pow.ts (new), apps/web/src/ui/PowField.tsx (new), apps/web/src/server/pow.test.ts (new)
- Tests first: T-WAUTH-6
- Do:
  - Own code, no package: the server issues { salt, challenge = SHA-256(salt + n), max } signed with the HMAC secret, valid 10 minutes, one use (row POW#<sha256 of salt> in the sessions table, TTL 10 minutes); start with max 100000.
  - The browser finds n with Web Crypto from a nonce-allowed script; tune max so a laptop needs about 1 second.
- Verify: `npm test --workspace @smart-finances/web -- src/server/pow.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-145 · Wrap every post: Origin, proof of work, limits
- Implements: AC-17, AC-19, D-115 · After: SF-144 · Judgment: high
- Files: apps/web/src/server/post.ts (new), apps/web/src/server/post.test.ts (new)
- Tests first: T-WAUTH-7
- Do:
  - Origin must equal WEB_ORIGIN; missing or null → 403. Auth posts also need a valid proof of work, then the counters.
  - A refusal returns the message keys auth.tooManyTries or auth.reload.
- Verify: `npm test --workspace @smart-finances/web -- src/server/post.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-146 · Refuse breached passwords
- Implements: AC-12, AC-20, D-117 · After: SF-141 · Judgment: high
- Files: apps/web/src/server/auth/breached.ts (new), apps/web/src/server/auth/breached.test.ts (new)
- Tests first: T-WAUTH-8
- Do:
  - GET https://api.pwnedpasswords.com/range/<first 5 of SHA-1, upper case> with Add-Padding; refuse when the suffix appears; on error accept and log breach_check_unavailable.
- Verify: `npm test --workspace @smart-finances/web -- src/server/auth/breached.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-147 · Sign up and confirm
- Implements: AC-12, AC-14, D-106, D-75 · After: SF-145, SF-146 · Judgment: high
- Files: apps/web/src/server/auth/signUp.ts (new), apps/web/src/server/auth/confirm.ts (new), apps/web/src/legal/versions.ts (new), apps/web/src/app/(auth)/sign-up/ (new), apps/web/src/server/auth/signUp.test.ts (new)
- Tests first: T-WAUTH-9, T-WAUTH-10
- Do:
  - SignUp with secret hash and clientMetadata.lang; accepted terms and privacy versions go to the pre-auth row.
  - Existing unconfirmed email: AdminDeleteUser, then sign up again with the new password (D-106). Existing confirmed email: the same reply, no email.
  - Code emails capped per email (Contracts "Limits"); confirm and resend.
- Verify: `npm test --workspace @smart-finances/web -- src/server/auth/signUp.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-148 · Sign in: password, authenticator setup and code
- Implements: AC-1, AC-13, D-73, D-91 · After: SF-147 · Judgment: high
- Files: apps/web/src/server/auth/signIn.ts (new), apps/web/src/server/auth/challenges.ts (new), apps/web/src/app/(auth)/sign-in/ (completes PR 1's placeholder), apps/web/src/server/auth/signIn.test.ts (new)
- Tests first: T-WAUTH-11, T-WAUTH-12
- Do:
  - InitiateAuth USER_PASSWORD_AUTH with secret hash; MFA_SETUP: AssociateSoftwareToken, QR drawn on the server as SVG (qrcode) for otpauth issuer "Cuenta" ("Cuenta qa" or "Cuenta staging" off prod), VerifySoftwareToken; SOFTWARE_TOKEN_MFA: RespondToAuthChallenge. reauth mode checks the result's sub equals the session's and creates no session.
  - State in the pre-auth row; an expired challenge returns to the password step; success deletes it and creates a new session.
  - UserNotConfirmed: resend within the cap and go to confirm.
- Verify: `npm test --workspace @smart-finances/web -- src/server/auth/signIn.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-149 · Record consent and gate the money screens
- Implements: AC-14, D-87, D-108 · After: SF-148 · Judgment: high
- Files: apps/web/src/server/accounts.ts (new), apps/web/src/server/guard.ts (new), apps/web/src/app/consent/ (new), apps/web/src/app/(app)/layout.tsx, apps/web/src/server/guard.test.ts (new)
- Tests first: T-WAUTH-13
- Do:
  - At the first completed sign-in write consent from the pre-auth row with putConsent; guard.ts (used by the money layout and every route handler) needs a session, a consent row and status active. resetStoredBytes leaves consent in place.
  - No consent row → /consent, which asks for the current TERMS_VERSION and PRIVACY_VERSION (the pre-auth row may have expired); refusing consent signs out.
- Verify: `npm test --workspace @smart-finances/web -- src/server/guard.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-150 · Reset the password and sign out everywhere
- Implements: AC-20, D-92, D-115 · After: SF-148 · Judgment: high
- Files: apps/web/src/server/auth/reset.ts (new), apps/web/src/app/(auth)/reset/ (new), apps/web/src/server/auth/reset.test.ts (new)
- Tests first: T-WAUTH-14
- Do:
  - ForgotPassword (same reply for any email, capped), ConfirmForgotPassword with the breached check, AdminGetUser for the sub, then signOutEverywhere; a notice cookie (HttpOnly, 10 minutes) makes the sign-in screen say "your password was changed"; a reset event is logged (D-122).
  - The next sign-in still asks for the authenticator.
- Verify: `npm test --workspace @smart-finances/web -- src/server/auth/reset.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-151 · Sign out
- Implements: AC-16, D-72 · After: SF-142 · Judgment: normal
- Files: apps/web/src/app/api/auth/sign-out/route.ts (new), apps/web/src/app/api/auth/sign-out/route.test.ts (new)
- Tests first: T-WAUTH-15
- Do:
  - A post only; deletes the row, revokes the refresh token, clears __Host-sid.
- Verify: `npm test --workspace @smart-finances/web -- src/app/api/auth/sign-out/route.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json
### SF-152 · Add the lost-authenticator, privacy and terms pages
- Implements: AC-14, D-103, D-115, D-118 · After: SF-141 · Judgment: normal
- Files: apps/web/src/app/lost-authenticator/ (new), apps/web/src/app/privacy/ (new), apps/web/src/app/terms/ (new), apps/web/e2e/public-pages.spec.ts (new); read docs/runbooks/lost-authenticator.md (PR 2)
- Tests first: T-WAUTH-16
- Do:
  - Draft both languages under TERMS_VERSION and PRIVACY_VERSION: what is stored (transactions, files, choices, rates, consent, sessions), where (AWS us-east-1), how long (until erase or delete; backups 35 days), rights to access, correct and delete, contact SUPPORT_ADDRESS, no advice and no money movement, and that qa is a test stage whose data may be wiped.
  - Lost authenticator shows SUPPORT_ADDRESS and the runbook steps.
  - The owner reviews the privacy and terms text before merge; Q-8 may change it.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/public-pages.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json
### SF-153 · Browser tests of the auth flows on fixtures
- Implements: AC-1, AC-12, AC-13, AC-17, AC-19, AC-20 · After: SF-150, SF-152 · Judgment: normal
- Files: apps/web/e2e/auth.spec.ts (new), apps/web/e2e/helpers/signIn.ts (new), apps/web/src/server/fakes/
- Tests first: T-WAUTH-17
- Do:
  - Extend the sign-in fake from SF-141 (selected by aws.ts when STAGE=test; email code 123456, authenticator code 000000); walk sign-up, confirm, setup, code, consent, reset, sign out and an ip-auth limit refusal in both languages. Add e2e/helpers/signIn.ts for PR 4.
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/auth.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json

## Stop and hand back when
- A task would deviate from a decision. Record the deviation first.
- A value this brief needs is missing.
- Verify is still red after 2 fix rounds.
- A change is needed outside the task's Files.
- Credentials or production access are needed.
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
No PR template exists (profile Notes). Include: what changed per task id, test ids and results, deviations, and the HUMAN steps left. The PR targets feature/web-ui (D-121), never qa.
