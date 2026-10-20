---
project: smart-finances
spec_home: .
ticket_source: none
ticket_prefixes: none
repos: smart-finances=../..
task_prefix.smart-finances: SF
base_branch.smart-finances: qa
verify.smart-finances: npm test; npm run build --workspace @smart-finances/infra
test.smart-finances: node --test {file}
preflight: node --version => v2; git --version => git version; gh --version => gh version
environment_file: ~/agent-kit/local/environment.md
---
# Spec profile: smart-finances

<!-- Spec folders live beside this file: docs/specs/<slug>/. The repo is public: never put personal data, names, account ids or credentials in any spec file. -->

## Rules to honour (pointers, not copies)
- README.md, section "Layout": only data/synthetic is committed.
- .gitignore, block "Real financial data stays local": data/real never enters git.
- docs/adr/README.md: one ADR per decision, named NNNN-short-title.md.
- docs/threat-model.md: update it when a trust boundary or data store changes.
- Public repo: no personal data, names or account ids in anything committed.

## Human-only actions
- Merge a PR; promote qa to staging to main.
- Anything that needs AWS credentials (bootstrap, deploys outside CI, console checks) or the Mercado Pago token.

## Notes
- No PR template. PRs target qa; the user reviews and merges. Merging into qa deploys the qa stack through the OIDC role.
- Worktrees: .claude/worktrees/<slug> (git-ignored through .git/info/exclude), branch feature/<slug>. Symlink data/real to the primary checkout's data/real; the data/* ignore rule keeps it out of git.
- Local data checks: npm run ingest:local reads and writes only data/real.
