---
spec: web-ui
ticket: none
tier: L
status: locked-v2
---
# Web UI: design system and screens: test matrix

<!-- One row per test, written at handoff: id (T-AREA-n), traces (AC or decision ids), task (a task id from a pr file, or manual), level (unit, int, e2e or manual), gate (G-merge, G-promote or none), check (one line). -->
<!-- Put the id in the real test title so grep finds it. Executors read only their own PR's rows. spec-lint checks that every AC is traced by a row or named in "Accepted, no test", and that every row names a task or manual, so there is no separate traceability table. Examples sit in these comments. -->

## Automated
<!-- unit and int rows, grouped by PR. Keep the check terse: one line, no Given/When/Then. When the change classifies a set (routes, keys, types), add one coverage test that pins the count, so a new member fails CI until someone classifies it. -->
| Test | Traces | Task | Level | Gate | Check |
|---|---|---|---|---|---|
| T-WEB-1 | AC-12, AC-14, AC-18, D-100 | SF-101 | manual | none | The prototype shows every auth and account screen and state in both languages; the owner approves. |
| T-WEB-2 | AC-6, D-133 | SF-102 | unit | G-merge | The contracts package exports FIELDS, KINDS, CATEGORIES and a schema per data route; the API's re-exports are unchanged. |
| T-WEB-3 | D-71, D-110 | SF-103 | unit | G-merge | /api/health returns { sha, stage } from the settings with no-store. |
| T-WEB-4 | AC-10, D-22, D-25 | SF-105 | unit | G-merge | tokens.css has the D-22 sizes, weights and spacing; no category colour equals the bad red. |
| T-WEB-5 | AC-4, D-11, D-126 | SF-106 | unit | G-merge | en and es catalogues have the same keys and every plural form. |
| T-WEB-6 | D-23, D-30, D-83 | SF-106 | unit | G-merge | Amount formats per D-23 and D-30; lang from the cookie, else Accept-Language. |
| T-WEB-7 | AC-16, AC-9, D-108 | SF-107 | unit | G-merge | Every response carries the contract headers with a fresh nonce; redirects use cookie presence only. |
| T-WEB-8 | AC-9, AC-16 | SF-107 | e2e | G-merge | In a browser, an inline script without the nonce does not run. |
| T-WEB-9 | AC-8, AC-10, D-63, D-141, D-143 | SF-109 | unit | G-merge | Field errors are tied by aria-describedby; Button shows busy; error notes use red, others never. |
| T-WEB-10 | AC-10, D-24, D-43, D-44 | SF-111 | e2e | G-merge | The rail and the top bar under 960px follow the decisions; focus moves to the main heading after navigation. |
| T-WEB-11 | AC-4 | SF-111 | e2e | G-merge | Switching language keeps the address and sets html lang. |
| T-WEB-12 | AC-8, AC-15 | SF-112 | e2e | G-merge | 403 and 404 show the same not-found screen; the idle sign-out notice shows on sign-in. |
| T-WINF-1 | AC-12, D-117, RK-5 | SF-121 | unit | G-merge | Synth: self sign-up on, Lite plan, password minimum 12; pool and old client keep their logical ids. |
| T-WINF-2 | D-73 | SF-121 | unit | G-merge | Synth: the web-server client has a secret, the password flow, 60-minute access and 12-hour refresh; no output or parameter holds the secret. |
| T-WINF-3 | AC-19, D-98, D-109 | SF-122 | unit | G-merge | The trigger refuses another client, signup-open not true, and a disposable domain. |
| T-WINF-4 | D-109 | SF-122 | unit | G-merge | Synth: the trigger's environment has no pool or client reference and the data stack has no cycle. |
| T-WINF-5 | AC-4, AC-12 | SF-123 | unit | G-merge | Code emails come out in es or en from the client metadata. |
| T-WINF-6 | AC-17, D-81 | SF-124 | unit | G-merge | Synth: audience lists both clients, throttle 50 and 100, no API CORS, no bucket CORS in the data stack. |
| T-WINF-7 | AC-15, D-72, D-87, D-111 | SF-125 | unit | G-merge | Synth: both tables, TTL on sessions, accounts retained with PITR on staging and prod; compute role grants exactly as listed. |
| T-WINF-8 | D-102, D-110, D-111 | SF-126 | unit | G-merge | Synth: the app and branch updates, a merging variables call, PassRole on two roles only, onDelete clears them. |
| T-WINF-9 | AC-5, D-88 | SF-127 | unit | G-merge | Synth: the bucket rule allows POST from the branch address. |
| T-WINF-10 | AC-12, D-106 | SF-128 | unit | G-merge | Housekeeping removes unconfirmed users older than 24 hours only. |
| T-WINF-11 | AC-18, D-104, D-107 | SF-128 | unit | G-merge | Housekeeping finishes a stuck deletion step by step, skips the erase when no delete function exists, and calls /api/health. |
| T-WINF-12 | D-80, RK-13 | SF-129 | unit | G-merge | Synth: every alarm in the contract exists; the heartbeat treats missing data as breaching. |
| T-WINF-13 | D-89 | SF-131 | unit | G-merge | Synth: no stack reads a parameter a later stack writes; dev has no web or alarms stack. |
| T-WINF-14 | D-93, D-113, RK-2, RK-3 | SF-132 | unit | G-merge | amplify-release.mjs fails on a failed job, a timeout, a wrong sha or a header that differs from the contract. |
| T-WAUTH-1 | AC-16, D-110 | SF-141 | unit | G-merge | Settings load from the named variables; secrets come from Secrets Manager, never a variable. |
| T-WAUTH-2 | D-80, RK-6 | SF-141 | unit | G-merge | The logger throws on password, code, secret, token, email or ip keys. |
| T-WAUTH-3 | AC-16, D-72 | SF-142 | unit | G-merge | Cookie flags per contract; table keys are hashes; idle and absolute limits refuse a row the TTL has not removed. |
| T-WAUTH-4 | AC-15, D-91 | SF-142 | unit | G-merge | Pre-auth rows expire after 15 minutes and are deleted at sign-in; a new session id each time. |
| T-WAUTH-5 | AC-17, D-120 | SF-143 | unit | G-merge | Counters refuse at each limit and reset at the window edge; keys hold no raw email or IP. |
| T-WAUTH-6 | AC-19, D-120 | SF-144 | unit | G-merge | A proof-of-work answer is accepted once, refused when reused, wrong or older than 10 minutes. |
| T-WAUTH-7 | AC-17, AC-19, D-115 | SF-145 | unit | G-merge | An action with a missing, null or foreign Origin gets auth.forbidden; an auth action without proof of work is refused. |
| T-WAUTH-8 | AC-12, AC-20, D-117 | SF-146 | unit | G-merge | A breached password is refused; only 5 hash characters are sent; an API error accepts and logs. |
| T-WAUTH-9 | AC-12, D-106 | SF-148 | unit | G-merge | Sign-up again with an unconfirmed email replaces it, so only the new password works. |
| T-WAUTH-10 | AC-12, D-75 | SF-148 | unit | G-merge | Known and unknown emails get the same reply and timing; code emails stop at the cap. |
| T-WAUTH-11 | AC-1, AC-13 | SF-149 | unit | G-merge | First sign-in walks setup then code; no session before the code. |
| T-WAUTH-12 | AC-1, D-91 | SF-149 | unit | G-merge | An expired challenge returns to the password step; 5 wrong codes start over. |
| T-WAUTH-13 | AC-14, D-87 | SF-150 | unit | G-merge | No money route answers without a consent row; resetStoredBytes keeps consent. |
| T-WAUTH-14 | AC-20, D-92 | SF-151 | unit | G-merge | After a reset, a session opened before it is refused and the authenticator is still asked. |
| T-WAUTH-15 | AC-16 | SF-151 | unit | G-merge | Sign-out is a post that removes the row and revokes the refresh token. |
| T-WAUTH-16 | AC-14, D-103 | SF-152 | e2e | G-merge | Privacy, terms and lost-authenticator pages render in both languages with one version id. |
| T-WAUTH-17 | AC-1, AC-12, AC-13, AC-17, AC-19, AC-20 | SF-153 | e2e | G-merge | On the fake sign-in service, sign-up to sign-out and a limit refusal work in both languages. |
| T-WSCR-1 | AC-6, AC-15, D-133 | SF-161 | unit | G-merge | The data API adapter sends the bearer token, parses replies with the contracts, maps statuses and times out at 5 seconds. |
| T-WSCR-2 | AC-2, D-85 | SF-162 | unit | G-merge | Typical month uses 3 to 6 earlier rated months and none below 3. |
| T-WSCR-3 | AC-11 | SF-162 | unit | G-merge | A month spending more than it earned is the bad case with the overspend amount. |
| T-WSCR-4 | AC-2, AC-8, D-101 | SF-164 | e2e | G-merge | The overview opens with the kept headline; one failed section leaves the others shown. |
| T-WSCR-5 | AC-11, D-63 | SF-164 | e2e | G-merge | In 2026-03, exactly one money figure is red. |
| T-WSCR-6 | AC-6 | SF-165 | e2e | G-merge | Each filter, sort and page change makes a request; free text never enters the address. |
| T-WSCR-7 | AC-8 | SF-166 | e2e | G-merge | Review and rates show their empty, failed and source states. |
| T-WSCR-8 | AC-17, D-114 | SF-167 | unit | G-merge | Five parallel import requests reserve exactly one slot; caps release at the final status. |
| T-WSCR-9 | AC-5 | SF-167 | e2e | G-merge | An import shows its status to the end and lists skipped rows with reasons. |
| T-WSCR-10 | AC-7 | SF-168 | e2e | G-merge | Erase needs DELETE, says 35 days, shows counts, and offers Finish erasing after a failure. |
| T-WSCR-11 | AC-18, D-104 | SF-169 | unit | G-merge | A deletion that fails at any step can be finished by the same session. |
| T-WSCR-12 | AC-18 | SF-169 | e2e | G-merge | Delete account needs a full re-sign-in and ends on the signed-out page with counts. |
| T-WSCR-13 | AC-9 | SF-170 | e2e | G-merge | Hostile synthetic rows show as text on every screen; no element, request or dialog comes from them. |
| T-WSCR-14 | AC-9 | SF-170 | unit | G-merge | No raw HTML insertion or markdown renderer exists in apps/web/src. |
| T-WSCR-15 | AC-10, D-22 | SF-171 | e2e | G-merge | axe finds no violation on any screen in both languages and themes. |
| T-WSCR-16 | AC-10, AC-4 | SF-171 | e2e | G-merge | Every action is reachable by keyboard with visible focus; a language switch keeps the screen. |
| T-WSCR-17 | AC-17 | SF-172 | e2e | G-merge | Past the person limit (120 a minute; 5 under STAGE=test) the 429 page shows; a second person is still served. |
| T-WEB-13 | D-132, D-138, D-140 | SF-104 | unit | G-merge | Lint fails on a domain file importing an adapter and on an a11y violation; Prettier check passes. |
| T-WEB-14 | D-138 | SF-108 | unit | G-merge | container.ts returns the memory adapters under STAGE=test, one per port. |
| T-WEB-15 | AC-10, D-129, D-136 | SF-109 | int | G-merge | Every part has stories in both languages and schemes; the Storybook a11y and interaction tests pass. |
| T-WEB-16 | D-127, D-130 | SF-110 | unit | G-merge | prefetch() dehydrates a query that the client provider reads without a request. |
| T-WEB-17 | D-134 | SF-113 | int | G-merge | Lighthouse on phone settings meets LCP 2.5 s, CLS 0.1 and 200 KB first-load JavaScript per route. |
| T-WINF-15 | D-135 | SF-130 | unit | G-merge | Synth: the RUM monitor and guest pool exist; the guest role may only put RUM events to that monitor. |
| T-WAUTH-18 | AC-1, AC-12, D-73 | SF-147 | unit | G-merge | The Cognito adapter sends the secret hash and language metadata; the memory fake accepts only its fixed codes. |
| T-WSCR-18 | AC-6, D-127 | SF-163 | unit | G-merge | Every /api/data route refuses without session and consent and returns contract-shaped JSON. |
| T-WSCR-19 | D-131 | SF-166 | e2e | G-merge | A review choice shows at once; a refused one rolls back with a plain message. |
| T-WSCR-20 | D-135 | SF-172 | unit | G-merge | RUM starts with no cookies, page ids without search values, no person id, and is off under STAGE=test. |

## End-to-end and manual
<!-- e2e rows and checks a person runs, in Given/When/Then. Fixtures use internal ids only; credentials never go in this folder. release.md says who runs each manual row and when. Example row: | T-E2E-1 | AC-1, D-1 | manual | manual | G-promote | Given a signed-in user, when they open a page that makes several calls, then exactly one page-view event appears. | -->
| Test | Traces | Task | Level | Gate | Check |
|---|---|---|---|---|---|
| T-E2E-1 | AC-1, AC-12, AC-13, AC-14, AC-20 | manual | manual | G-merge | Given a test address on qa, when the owner signs up, confirms, sets up the authenticator, accepts, signs in, resets and signs out, then each step ends as States and exits says. |
| T-E2E-2 | AC-15, D-61 | manual | manual | G-promote | Given two accounts on qa with data, when the second opens every screen, then it sees none of the first one's data. |
| T-E2E-3 | AC-17, AC-19 | manual | manual | G-merge | Given qa, when a script posts sign-up without a proof-of-work answer or past the limit, then it is refused with the plain message. |
| T-E2E-4 | D-93, RK-2 | manual | manual | G-merge | Given a merge into qa, when CI finishes, then /api/health reports the commit and the headers match. |
| T-E2E-5 | D-80, D-107 | manual | manual | G-promote | Given qa for 2 hours, when one test signin_fail is made, then its metric moves and the heartbeat alarm stays OK. |
| T-E2E-6 | AC-18, D-104 | manual | manual | G-promote | Given a qa test account, when it is deleted, then its data, pool user and sessions are gone. |

## Accepted, no test
<!-- Edge cases, or ACs, closed by a decision or a risk instead of a test, with a one-line reason. Name the AC id when the row covers one. Example row: | Events written before the release have no page type. | RK-1 | They expire on their own; no backfill. | -->
| Edge case | Closed by | Reason |
|---|---|---|
| Credential stuffing from rotating addresses without a firewall | RK-15, RK-16 | Accepted in D-117 and D-120; counters, proof of work and TOTP limit it. |
| The assistant half of AC-9 | D-46 | The assistant is built in Epic 4. |
| Breached-password service down | D-117 | The password is accepted and the miss logged. |
