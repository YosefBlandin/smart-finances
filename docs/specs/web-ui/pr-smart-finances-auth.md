---
spec: web-ui
ticket: none
tier: L
status: executing
---
# Web UI: design system and screens: brief for smart-finances (PR 3 of 4, auth)

<!-- The executor's main document. It must stand alone: copy values in, and link only to sections a task cites. At most 6k tokens; comments do not count. Required reading (intent.md, this file and its Read first sections) stays under 15k. Before the lock, the cold-read dry run must find zero "cannot start" items. -->

- Goal: people can sign up, confirm, set up an authenticator, sign in, reset and sign out, with server-held sessions, limits and consent, built as hexagonal use cases.
- Implements: AC-1, AC-12 to AC-17, AC-19, AC-20, D-72, D-73, D-75, D-87, D-91, D-92, D-103, D-106, D-108, D-115, D-117, D-120, D-124, D-125, D-138
- Spec folder: /home/user/smart-finances/docs/specs/web-ui in a cloud session; locally <repo root>/docs/specs/web-ui. Read and write the spec there, on the branch named under Branch, never a copy elsewhere.
- Refs: smart-finances at the sha in intent.md refs. Before the first task: `git fetch origin qa feature/web-ui`, then `node ~/.claude/skills/spec/scripts/drift.mjs docs/specs/web-ui --strict` (exit 0; NEW lines are expected)
- Worktree: a cloud session's own checkout; locally <repo root>/.claude/worktrees/web-auth (profile Notes)
- Profile verify (full, at the baseline and before the PR): `npm test` and `npm run build --workspace @smart-finances/infra`. Before PR 1's SF-104 no lint exists; record "none". From then on also `npm run lint --workspace @smart-finances/web`.
- Every task may also touch, without stopping: apps/web/package.json and package-lock.json (for packages this brief allows), apps/web/messages/en.json and es.json (new keys only, both files), apps/web/src/adapters/container.ts and adapters/memory/ (to register what the task adds), and its own *.module.css files.
- Judgment: high tasks get a fresh-context reviewer before done: a subagent or fresh chat given the task, its diff and the review prompt in ~/.claude/skills/spec/references/handoff-prompts.md.
- Branch: feature/web-auth · Base: origin/feature/web-ui, after the previous PR is merged into it · Draft PR into feature/web-ui (D-121)
- Brief version: the locked-vN named in the handoff prompt; record it as pr-smart-finances-auth.md@locked-vN in progress-smart-finances-auth.json
- Order: PR 3 of 4.

## Read first
1. This file, all of it.
2. intent.md: Acceptance criteria, No-gos, Glossary.
3. architecture.md: Components "Code structure", "Auth flows (web server)", "Sessions and accounts"; Contracts "Ports", "Interfaces between the PRs", "Cookies", "Sessions table", "Accounts table", "Limits", "Password and code rules", "Security events", "Web server settings"; "States and exits" rows sign-up to reset confirm.
4. CLAUDE.md in the worktree, if present.
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
- D-145: Terms and privacy are accepted once, at sign-up. The privacy and terms pages are read-only full text; when either version changes, the consent screen asks the person to accept the new version before any money screen opens. Narrows D-87.
- D-91: Pre-auth state: a server-side row keyed by a separate __Host-pre cookie (SameSite=Strict) holds the step, the sign-in service's challenge session, the new key during setup and the accepted versions, for 15 minutes; the client's challenge session lasts 15 minutes; an expired challenge returns to the password step.
- D-92: After a password reset, the web server signs the person out everywhere (admin global sign-out on this pool) and removes their session rows. The compute role may do that and get or delete users on this pool only.
- D-103: Lost authenticator: the code and reset screens link to a page with the stage's support address (a role address, a stage parameter) and what the owner asks to confirm identity.
- D-104: Delete account, final: first a full re-sign-in (password and code) and no running import; then mark deleting; that session alone may reach the finish route; erase, global sign-out, delete the pool user, remove rows. The hourly job finishes a stuck deletion by invoking the data service's delete function with the sub (one function, one grant; a follow-up row in the data-architecture spec) and alarms after 6 hours. Supersedes D-97.
- D-106: Unconfirmed sign-ups: a new sign-up for an unconfirmed email deletes the old one and starts again with the new password; code emails per email are capped at 3 an hour and 10 a day, with the same reply either way; the hourly job alone may list users to remove unconfirmed ones after 24 hours. Supersedes D-99.
- D-147: The confirm screen states no code lifetime; a code that fails offers "Send a new code". auth.confirm.lead becomes "We sent a 6-digit code to {email}. The account is created once you enter it." / "Enviamos un código de 6 dígitos a {email}. La cuenta se crea cuando lo ingresas."
- D-148: The lost-authenticator page promises no reply time, only the 72-hour wait (D-115). auth.lost.wait becomes "Once we confirm it’s you, we wait 72 hours before the reset, so nobody else can do it quickly." / "Cuando confirmamos que eres tú, esperamos 72 horas antes de restablecerlo, para que nadie más pueda hacerlo rápido." Narrows D-103.
- D-108: Middleware does only the nonce, the content policy and a cookie-presence redirect; the session, consent and deleting checks run in a server-only helper called by the money layout and every route handler.
- D-110: Web server settings: one contract table (architecture.md); the branch-variables custom resource merges into Amplify's map without dropping keys; amplify.yml writes the listed names and the commit id into .env.production before the build.
- D-115: Security baseline: OWASP ASVS 5.0 level 2. The Origin must equal the stage's web address from the settings; a missing or null Origin is refused; sign-out is a post; counter keys are an HMAC of the email or address prefix. A notice email goes out after a password reset or an authenticator reset. Lost-authenticator recovery asks a reply from the account email plus details only the person knows, waits 72 hours, then signs out everywhere. Narrows D-75 and D-103.
- D-117: No paid Cognito plan: the pool stays on Lite with no threat protection; the web server refuses breached passwords at sign-up and reset through the free Pwned Passwords range API (only the first 5 characters of the password's SHA-1 leave the server; if the API is down, the password is accepted and the miss logged); no context data is sent. Supersedes D-94 and narrows D-73.
- D-118: qa is open to anyone: signup-open is true on qa, with no allow-list. The user accepts strangers' data on qa before the legal answer, on a stage whose data may be wiped; the privacy notice says qa is a test stage. Staging and prod stay closed until Q-8. Narrows D-98 and D-109.
- D-120: No WAF for now, on any stage. Limits live in the web server's window counters: auth posts per IP 20 per 5 minutes, sign-in or reset failures per email and address prefix 5 per 15 minutes, code emails per email 3 an hour and 10 a day, data requests per person 120 a minute. A self-hosted proof-of-work check (served from the site, no third party) guards sign-up and the auth posts instead of the WAF challenge. The user accepts that floods reach the web server's compute. Supersedes D-90 and D-105.
- D-121: Integration branch: the four PRs (foundation, infra, auth, screens) each open as a draft into feature/web-ui, in order; once all are merged there, one PR from feature/web-ui into qa ships infra and web in one merge. The agent commits, pushes its feature branches and opens draft PRs; the user reviews, merges and promotes. Narrows D-6.
- D-122: Until SES is set up (D-77), the notice after a password or authenticator reset is shown on the next sign-in screen and logged as a security event, not emailed; the email is added with SES before staging and prod open sign-up. Narrows D-115.
- D-124: Zod validates every boundary: server action inputs, the JSON routes' inputs, every data API reply mirrored in types.ts, and the settings. Bad input becomes a plain error message, never a crash.
- D-125: Forms submit through Next.js server actions, each wrapped by one guarded(action, opts) helper (exact Origin, proof of work for auth, limits, session and consent, Zod input). Route handlers remain only for health, the proof-of-work challenge, export, language and the JSON reads. Narrows D-82 and D-115.
- D-138: Code architecture: the web server's logic is hexagonal (domain, application use cases, ports, adapters, with in-memory adapters for tests and Storybook); Next.js app/ only delivers (pages, layouts, server actions, JSON routes) and calls use cases through one container; presentation (ui, screens, queries, i18n) follows Next.js conventions. ESLint import rules enforce the dependency direction.
- Values:
  - Packages allowed: @aws-sdk/client-cognito-identity-provider, -dynamodb, @aws-sdk/lib-dynamodb, -secrets-manager, -ssm, qrcode.
  - Username in the pool is the sub; sign-in uses the lower-cased email as the login.
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
### SF-141 · Add the settings, secrets and logger ports with their adapters
- Implements: AC-16, D-110, D-80, D-115, D-138 · After: SF-140 · Judgment: high
- Files: apps/web/src/ports/{Settings,SecretStore,Logger}.ts, apps/web/src/adapters/{env-settings,secrets,log}.ts (new), apps/web/src/adapters/memory/, apps/web/src/adapters/container.ts, apps/web/src/adapters/adapters.test.ts (new)
- Tests first: T-WAUTH-1, T-WAUTH-2
- Do:
  - Settings from the names in Contracts "Web server settings" (Zod-parsed), with STAGE=test defaults; secrets from Secrets Manager through the compute role, cached 5 minutes; plain strings.
  - Logger writes one JSON security event per line and throws on keys named password, code, secret, token, email or ip.
- Verify: `npm test --workspace @smart-finances/web -- src/adapters/adapters.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-142 · Sessions and pre-auth: policy, port and DynamoDB adapter
- Implements: AC-15, AC-16, D-72, D-91 · After: SF-147 · Judgment: high
- Files: apps/web/src/domain/session-policy.ts (new), apps/web/src/adapters/dynamodb/sessions.ts (new), apps/web/src/application/session.ts (new), apps/web/src/app/cookies.ts (new: sets and reads __Host-sid and __Host-pre with next/headers), apps/web/src/domain/session-policy.test.ts (new), apps/web/src/adapters/dynamodb/sessions.test.ts (new)
- Tests first: T-WAUTH-3, T-WAUTH-4
- Do:
  - Policy: idle 30 minutes, absolute 12 hours, refresh when under 5 minutes left; reads check both themselves.
  - Cookies and rows as Contracts "Cookies" and "Sessions table"; keys SHA-256 of the cookie id; refresh uses the sub as username in the secret hash; signOutEverywhere(sub) uses bySub and AdminUserGlobalSignOut.
- Verify: `npm test --workspace @smart-finances/web -- src/domain/session-policy.test.ts` and `npm test --workspace @smart-finances/web -- src/adapters/dynamodb/sessions.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-143 · Limits: window math, counter port and adapter
- Implements: AC-17, D-120, D-115 · After: SF-142 · Judgment: high
- Files: apps/web/src/domain/limits.ts (new), apps/web/src/application/limits.ts (new: hit(scope, value)), apps/web/src/adapters/dynamodb/counters.ts (new), apps/web/src/domain/limits.test.ts (new)
- Tests first: T-WAUTH-5
- Do:
  - Window start = floor(now / window) * window; scopes and values per Contracts "Limits"; keys HMAC-SHA256 base64url of email|address prefix (IPv4 /24, IPv6 /48) or the sub; client IP is the right-most X-Forwarded-For entry. STAGE=test person limit 5 a minute.
- Verify: `npm test --workspace @smart-finances/web -- src/domain/limits.test.ts` → pass, window edges included
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-144 · Proof of work
- Implements: AC-19, D-120 · After: SF-143 · Judgment: high
- Files: apps/web/src/application/pow.ts (new), apps/web/src/ports/PowStore.ts, apps/web/src/adapters/dynamodb/pow.ts (new), apps/web/src/app/api/auth/pow/route.ts (new), apps/web/src/ui/PowField.tsx (new), apps/web/src/application/pow.test.ts (new)
- Tests first: T-WAUTH-6
- Do:
  - GET /api/auth/pow issues { salt, challenge = SHA-256(salt + n), max, expires, sig } (HMAC-SHA256); one use via row POW#<sha256 of salt>, TTL 10 minutes; max starts at 100000.
  - PowField (client, nonce from x-nonce) solves with Web Crypto and adds powSalt, powN, powSig to the form.
- Verify: `npm test --workspace @smart-finances/web -- src/application/pow.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-145 · The guarded() wrapper for server actions
- Implements: AC-15, AC-17, AC-19, D-115, D-124, D-125 · After: SF-144 · Judgment: high
- Files: apps/web/src/app/guarded.ts (new), apps/web/src/app/guarded.test.ts (new)
- Tests first: T-WAUTH-7
- Do:
  - guarded(schema, { kind: "auth" }, fn) for now: exact Origin = WEB_ORIGIN from headers() (missing or null → messageKey auth.forbidden), then proof of work, then the counters, then the Zod input. SF-150 adds kind "money".
  - Returns { ok: true, data } or { ok: false, messageKey, retryAfterSeconds? }; never throws to the client.
- Verify: `npm test --workspace @smart-finances/web -- src/app/guarded.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-146 · Breached-password check
- Implements: AC-12, AC-20, D-117 · After: SF-141 · Judgment: high
- Files: apps/web/src/ports/BreachChecker.ts, apps/web/src/adapters/pwned.ts (new), apps/web/src/adapters/pwned.test.ts (new)
- Tests first: T-WAUTH-8
- Do:
  - GET https://api.pwnedpasswords.com/range/<first 5 of SHA-1, upper case> with Add-Padding: true, 2-second timeout; refuse when the suffix appears; on error accept and log breach_check_unavailable.
- Verify: `npm test --workspace @smart-finances/web -- src/adapters/pwned.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-147 · Identity provider port and Cognito adapter
- Implements: AC-1, AC-12, AC-13, AC-20, D-73 · After: SF-141 (runs before SF-142) · Judgment: high
- Files: apps/web/src/ports/IdentityProvider.ts, apps/web/src/adapters/cognito.ts (new), apps/web/src/adapters/memory/identity.ts, apps/web/src/adapters/cognito.test.ts (new)
- Tests first: T-WAUTH-18
- Do:
  - The IdentityProvider methods in architecture.md Contracts "Ports"; secret hash base64(HMAC-SHA256(secret, username + client id)); clientMetadata.lang on sign-up and reset. Tests use a hand-written fake SDK client.
  - Memory fake: email code 123456, authenticator code 000000, deterministic subs.
- Verify: `npm test --workspace @smart-finances/web -- src/adapters/cognito.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-148 · Sign up and confirm
- Implements: AC-12, AC-14, D-106, D-75, D-147 · After: SF-145, SF-146, SF-147 · Judgment: high
- Files: apps/web/src/application/auth/{signUp,confirm}.ts (new), apps/web/src/legal/versions.ts (new), apps/web/src/app/(auth)/sign-up/ (new, page and actions.ts), apps/web/src/application/auth/signUp.test.ts (new)
- Tests first: T-WAUTH-9, T-WAUTH-10
- Do:
  - Accepted TERMS_VERSION and PRIVACY_VERSION ("2026-11-01") go to the pre-auth row; an unconfirmed existing email is deleted and signed up again (D-106); a confirmed one gets the same reply and no email; code emails capped; replies padded to 800 ms.
  - Set auth.confirm.lead in en.json and es.json to the D-147 text (an existing key; allowed here).
- Verify: `npm test --workspace @smart-finances/web -- src/application/auth/signUp.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-149 · Sign in: password, authenticator setup and code
- Implements: AC-1, AC-13, D-73, D-91 · After: SF-148 · Judgment: high
- Files: apps/web/src/application/auth/signIn.ts (new), apps/web/src/app/(auth)/sign-in/ (completes PR 1’s placeholder; actions.ts), apps/web/src/application/auth/signIn.test.ts (new)
- Tests first: T-WAUTH-11, T-WAUTH-12
- Do:
  - Setup QR drawn on the server as SVG (qrcode), issuer "Cuenta" ("Cuenta qa" or "Cuenta staging" off prod); state in the pre-auth row; an expired challenge returns to the password step; 5 wrong codes start over; success creates a new session. reauth mode checks the sub and creates none.
  - UserNotConfirmed: resend within the cap and go to confirm.
- Verify: `npm test --workspace @smart-finances/web -- src/application/auth/signIn.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-150 · Consent, the account store and the money guard
- Implements: AC-14, D-87, D-108, D-145 · After: SF-149 · Judgment: high
- Files: apps/web/src/adapters/dynamodb/accounts.ts (new), apps/web/src/application/guard.ts (new), apps/web/src/app/guarded.ts (adds kind "money"), apps/web/src/app/consent/ (new), apps/web/src/app/(app)/layout.tsx, apps/web/src/application/auth/signIn.ts (writes consent), apps/web/src/application/guard.test.ts (new)
- Tests first: T-WAUTH-13
- Do:
  - AccountStore per Contracts "Ports", with conditional updates; guarded kind "money" (opts allowDeleting) runs requireMoneyAccess before the input.
  - Consent from the pre-auth row at the first completed sign-in; requireMoneyAccess needs session, consent at the current TERMS_VERSION and PRIVACY_VERSION, and status active; no row or an older version goes to /consent, which asks for the current versions (D-145); refusing signs out.
- Verify: `npm test --workspace @smart-finances/web -- src/application/guard.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-151 · Reset the password and sign out
- Implements: AC-16, AC-20, D-92, D-122 · After: SF-149 · Judgment: high
- Files: apps/web/src/application/auth/{reset,signOut}.ts (new), apps/web/src/app/(auth)/reset/ (new), apps/web/src/app/(auth)/sign-in/page.tsx (shows the notice), apps/web/src/application/auth/reset.test.ts (new)
- Tests first: T-WAUTH-14, T-WAUTH-15
- Do:
  - Forgot (same reply for any email, capped), confirm with the breached check, adminGet for the sub, signOutEverywhere, then a 10-minute HttpOnly notice cookie so sign-in says "your password was changed" (D-122).
  - Sign out is a server action: delete the row, revoke the refresh token, clear __Host-sid.
- Verify: `npm test --workspace @smart-finances/web -- src/application/auth/reset.test.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json, and the reviewer has no blocker
### SF-152 · Lost-authenticator, privacy and terms pages
- Implements: AC-14, D-103, D-115, D-118, D-145, D-148 · After: SF-141 · Judgment: normal
- Files: apps/web/src/app/{lost-authenticator,privacy,terms}/ (new), apps/web/e2e/public-pages.spec.ts (new)
- Tests first: T-WAUTH-16
- Do:
  - Drafts in both languages under the versions: what is stored, where (AWS us-east-1), how long (until erase or delete; backups 35 days), rights, SUPPORT_ADDRESS, no advice or money movement, and that qa is a test stage whose data may be wiped. The pages are read-only, with no accept button (D-145). Set auth.lost.wait in en.json and es.json to the D-148 text (an existing key; allowed here). Lost authenticator follows docs/runbooks/lost-authenticator.md (PR 2).
- Verify: `npm run e2e --workspace @smart-finances/web -- e2e/public-pages.spec.ts` → pass
- Done when: verify is green, evidence is in progress-smart-finances-auth.json
### SF-153 · Browser tests of the auth flows
- Implements: AC-1, AC-12, AC-13, AC-17, AC-19, AC-20 · After: SF-150, SF-151, SF-152 · Judgment: normal
- Files: apps/web/e2e/auth.spec.ts (new), apps/web/e2e/helpers/signIn.ts (new)
- Tests first: T-WAUTH-17
- Do:
  - Under STAGE=test walk sign-up, confirm, setup, code, consent, reset, sign out and an ip-auth refusal in both languages; helpers/signIn.ts signs a test person in for PR 4.
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
