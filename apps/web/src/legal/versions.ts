// The privacy notice and terms versions a sign-up accepts (D-87, D-145; architecture.md "Interfaces between the PRs").
// A sign-up stores both in its pre-auth row; the first completed sign-in writes them to the accounts table, and the
// consent screen asks again when either changes. app/privacy/_legal/versions.ts re-exports these ids for the pages. Change
// one only together with its text in messages/en.json and es.json (legal.*).
export const TERMS_VERSION = '2026-11-01';
export const PRIVACY_VERSION = '2026-11-01';
