---
spec: web-ui
ticket: none
tier: L
status: draft
---
# Web UI: design system and screens: review

<!-- Tables only. Scripts check what can be checked; reviewers judge the rest. No numeric scores and no self-grading: every reviewer is a fresh context, ideally on a different model. M tier adds this file with new-spec.mjs --add review.md when it first needs it. Examples sit in these comments. -->

## Lens review
<!-- At G-design. One fresh reviewer per lens: security and data; contract and deploy; pre-mortem (states and exits); frontend when there is a web or app UI PR. Reviewers report only correctness or requirement gaps, with evidence. Rows have no ids; cite the AC or decision a finding touches. Severity: blocker, major or minor. Disposition: accepted (what changed, where) or rejected (why, with evidence). Example row: | contract and deploy | major | Reads would still write an event per call if the old logger stays on. | D-1 | architecture.md Components | accepted: the logger skips reads; a test checks it | -->
| Lens | Severity | Finding | Cites | Evidence | Disposition |
|---|---|---|---|---|---|
| security, contract, premortem | blocker | Consent cannot be written in the person's partition, and erase-all would delete it. | AC-14, D-78 | architecture.md Contracts, Web stacks | accepted: accounts table owned by the web server, written at first sign-in (D-87) |
| contract | blocker | The data stack reads the web address that the later web stack writes. | AC-5, D-81 | stage-values.ts; Release order | accepted: the web stack sets the bucket rule (D-88) |
| contract | blocker | The web stack cannot read the web ACL ARN from another region. | D-76, D-84 | stage-values.ts | accepted: all stacks in us-east-1, the web ACL inside the web stack (D-89) |
| frontend, security, contract, premortem | major | WAF challenge and CAPTCHA cannot run on posts; the script integration breaks the content policy. | AC-17, AC-19, D-76 | AWS WAF CAPTCHA and Challenge docs | accepted: challenge on GET only, block with custom 429 on posts (D-90) |
| security, premortem | major | No storage for the state between sign-in steps; the challenge session lasts 3 minutes. | AC-1, AC-13, D-72 | Contracts, Cookies | accepted: pre-auth row and cookie, 15-minute challenge (D-91) |
| security | major | A password reset does not end other sessions. | AC-20, D-75 | States and exits, reset confirm | accepted: global sign-out and rows removed (D-92) |
| security, premortem | major | Per-minute counters cannot hold a 15-minute limit; the email limit can lock out a victim. | AC-17, D-76 | Contracts, Sessions table | accepted: window counters per email and address prefix, reads check expiry (D-90) |
| contract | major | Amplify builds race the CI deploy and miss the first push. | D-65 | deploy.yml; F-35 | accepted: auto-build off, CI starts the job and polls the sha (D-93) |
| contract | major | Reverting the merge leaves a broken live app. | D-68 | Cross-cutting, Rollback | accepted: ordered rollback card in release.md |
| contract | major | No path for the client secret between stacks. | D-73 | Web stacks | accepted: secret in the data stack, only its ARN as a parameter |
| contract | major | Audit mode does not block breached passwords. | D-74, D-75 | Password rules | accepted: full mode for breached passwords at launch (D-94) |
| contract | major | us-east-1 bootstrap, region and token steps missing. | D-84 | bin/app.ts | accepted: one region (D-89); console app with no token (D-102); steps in release.md |
| premortem | major | An unconfirmed account has no exit. | AC-12 | States and exits | accepted: resend and confirm; housekeeping removes after 24 hours (D-99) |
| premortem | major | Account Lambda concurrency of 10 starves reads. | AC-17, D-81 | infra/lib/function.ts | accepted: quota raise and reservations before sign-up (D-95, RK-12) |
| premortem | major | Nothing caps one account's imports or storage. | D-67, AC-17 | Data service changes | accepted: per-person caps and pause switch (D-96) |
| premortem | major | Delete account can be left half-done and other sessions can still write. | AC-18, D-79 | States and exits | accepted: deleting status, repeatable steps, hourly finisher, fresh code (D-97) |
| premortem | major | Security alarms may never fire: no log group or role, no missing-data rule. | D-80 | Alarms | accepted: log group and service role in the web stack; heartbeat alarm (RK-13) |
| premortem | major | Strangers can store data on qa before the legal answer. | D-61, AC-14 | Release order; Q-8 | accepted: qa allow-list in the pre-sign-up trigger until Q-8 (D-98) |
| frontend | major | The prototype has no sign-up, reset, delete or limit screens. | AC-12, AC-14, AC-18, D-4 | prototype grep | accepted: prototype first (D-100) |
| frontend | major | Prototype copy promises tab-close sign-out and temporary passwords. | AC-16, D-72 | prototype copy | accepted: copy fixed in D-100; new-password route removed |
| frontend | major | No not-found or signed-out-mid-task state. | AC-8, AC-15 | Screen states | accepted: column added; 403 and 404 share one screen |
| frontend | major | Lost authenticator has no exit on screen. | AC-20 | No-gos | accepted: lost-authenticator page with the support address (D-103) |
| frontend | major | No streaming, so skeletons do not show on first load and one failed read hides the page. | AC-8, D-65 | D-65 | accepted: per-section failure and 5-second timeout (D-101) |
| frontend | major | Delete account and erase look alike and lack a confirm. | AC-18, AC-7 | Screens | accepted: separate labels; delete needs a fresh code (D-97) |
| security | minor | The public client lets anyone call sign-up directly. | AC-19, D-73 | data-stack.ts | accepted: trigger accepts only the web-server client; public client removed (D-98) |
| security | minor | TTL is lazy and the refresh token outlives the session. | AC-16, D-72 | Sessions table | accepted: reads check expiry; refresh token 12 hours |
| security | minor | Unconfirmed sign-ups can squat an email. | AC-12 | States and exits | accepted: removed after 24 hours (D-99) |
| security | minor | Erase and delete need re-authentication. | AC-7, AC-18 | ASVS V7.5 | accepted for delete account (fresh code); rejected for erase: AC-7, approved at DP2 (D-69), already asks for the typed word and erased data stays restorable for 35 days |
| security | minor | Log retention and the trusted client IP are unstated. | D-80 | Auth flows | accepted: one-month log group; right-most forwarded entry, checked on qa |
| frontend | minor | Language switch loses the form. | AC-4 | Words | accepted: address kept, unsent input cleared (D-83) |
| frontend | minor | Privacy, terms and code emails have no language rule. | AC-4, AC-14 | Words | accepted: both languages, custom message trigger |
| frontend | minor | Form errors and contrast lack checks. | AC-10, D-22 | Web app | accepted: aria rules added; an axe check in the browser tests |
| contract | minor | Alarms deploy before the log group exists. | D-80 | Release order | accepted: the web stack creates the log group before alarms |
| premortem, security, contract (round 2) | blocker | A half-done account deletion cannot be finished: the person is refused and the job has no token. | AC-18, D-97 | architecture.md Web app; data-architecture DELETE /data | accepted: the deleting session may finish; the job invokes the delete function; alarm after 6 hours (D-104) |
| premortem (round 2) | major | No Cognito call checks a TOTP code for a signed-in person. | AC-18, D-97 | F-28 | accepted: full re-sign-in before delete (D-104) |
| premortem (round 2) | major | Scripts can post to the auth handlers and skip the challenge. | AC-19, D-90 | AWS WAF token labels | accepted: challenge on auth posts with a reload message (D-105) |
| premortem (round 2) | major | An unconfirmed sign-up keeps the first password, so an email can be squatted. | AC-12, D-99 | States and exits | accepted: replace the unconfirmed user on a new sign-up (D-106) |
| premortem, security (round 2) | major | The hourly job cannot list unconfirmed users. | D-99 | Cross-cutting grants | accepted: list users for the job only (D-106) |
| premortem (round 2) | major | Nothing caps code emails per email. | AC-19, RK-7, D-77 | Limits | accepted: 3 an hour, 10 a day (D-106) |
| premortem (round 2) | major | The heartbeat has no caller and would fire every hour. | RK-13, D-80 | Alarms | accepted: the hourly job calls /api/health (D-107) |
| premortem (round 2) | major | Middleware may not run the AWS SDK on Amplify. | AC-15, AC-16 | F-35 | accepted: middleware without SDK; checks in a server helper (D-108, RK-14) |
| security (round 2) | major | WAF logs would keep session cookies. | AC-16, D-80 | Web stack | accepted: cookie redacted; only blocked or challenged requests logged (D-105) |
| security (round 2) | major | Lost-authenticator recovery has no identity proof. | D-103, AC-20 | ASVS V6.4 | accepted: runbook with proof, 72-hour wait, sign-out, notice (D-115) |
| security (round 2) | major | Import caps can be raced and stored bytes has no writer. | D-96, AC-17 | Accounts table | accepted: one conditional reservation (D-114) |
| security (round 2) | minor | Origin check has no exact target; Referer is off. | AC-15 | Cross-cutting | accepted: exact stage address, missing refused (D-115) |
| security (round 2) | minor | Counter keys hold raw emails. | D-90 | Sessions table | accepted: HMAC keys (D-115) |
| security (round 2) | minor | No ASVS level; no notice after a reset. | D-75 | D-75 | accepted: level 2 and notice emails (D-115) |
| contract (round 2) | major | CI cannot start Amplify jobs or read the app id. | D-93 | github-oidc-stack.ts | accepted: OIDC stack redeploy as a HUMAN step (D-113) |
| contract (round 2) | major | A trigger reading the client id from its environment makes a cycle. | D-98 | data-stack.ts | accepted: triggers read SSM at run time (D-109) |
| contract (round 2) | major | No per-stage switch keeps sign-up off; console changes are undone by deploys. | D-98 | Rollback card | accepted: signup-open parameter (D-109) |
| contract (round 2) | major | The web server's settings have no contract; Amplify's variable map can be wiped. | D-65, D-93 | Web stack | accepted: settings table and merged variables (D-110) |
| contract (round 2) | major | Rollback (c) loses consent and leaves the app serving. | D-87, D-102 | release.md | accepted: retained accounts table; rollback (c) rewritten (D-111) |
| contract (round 2) | major | The console app's log group already exists, so creating it fails. | D-102 | Web stack | accepted: referenced by name, retention by custom resource (D-112) |
| contract (round 2) | minor | The deploy job will pass 20 minutes. | D-93 | deploy.yml | accepted: poll 15 minutes, job 45 (D-113) |

## Cold-read log
<!-- At G-handoff, one run per brief and round: a fresh context on a cheaper or different model gets only intent.md, the brief and the sections it cites (tier S: spec.md). Model class is cheaper, different, or same in a fresh context; never a model name. Gate: zero cannot-start items. -->
| Brief | Round | Date | Model class | Cannot start | Missing values | Assumptions | Fixed in |
|---|---|---|---|---|---|---|---|
| pr-smart-finances.md | 1 | 2026-10-30 | cheaper | 1 (SF-110 ADR number taken) | 9 | 9 | ADR 0008 and 0009; shared interfaces; stub pages; key names; packages; token names |
| pr-smart-finances-infra.md | 1 | 2026-10-30 | cheaper | 0 | 16 | 14 | branch per stage, metrics, makeFunction, release script args and tests, email text, cited contracts |
| pr-smart-finances-auth.md | 1 | 2026-10-30 | cheaper | 0 | 18 | 13 | aws.ts fakes, scope names, PoW row, versions, issuer, guard wiring, D-122 notice |
| pr-smart-finances-screens.md | 1 | 2026-10-30 | cheaper | 0 | 18 | 14 | module and route names, rounding, data-tone selector, caps inputs, test limit, themes |

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
