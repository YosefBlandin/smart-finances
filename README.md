# smart-finances

A personal finance assistant: import your money data, see it in a dashboard, and ask questions answered by tools and RAG with citations. Built on serverless AWS with an evaluation suite and an AI security review.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js app: dashboard, chat UI and its web server ([ADR 0008](docs/adr/0008-web-framework-and-host.md)) |
| `apps/api` | Lambda handlers |
| `packages/contracts` | Shared by `apps/web` and `apps/api`: Zod schemas for the data routes, the field, kind and category lists |
| `infra` | AWS CDK stacks |
| `evals` | Golden set, harness, regression gate |
| `docs/adr` | Architecture decision records |
| `data/synthetic` | Synthetic dataset (the only data committed) |

## Branches

`main` (history of the previous Angular app until this lands) · `qa` · `staging` · `feature/*`

The Vercel project linked to this repo built the old Angular app. `vercel.json` turns off its Git deployments until `apps/web` has a real app; re-enable them then and point the project's root directory at `apps/web`.

## Status

Early scaffold. Work is tracked as Epics 0-7 in the execution plan.

The web app is hosted on Amplify Hosting ([ADR 0008](docs/adr/0008-web-framework-and-host.md)). The Vercel project stays off: `vercel.json` keeps its Git deployments disabled.

## Release checks

`scripts/api-call.mjs` calls one data route of a deployed stage as a given person, for the checks in [the data release steps](docs/specs/data-architecture/release.md). It builds the event the API's JWT authorizer would pass on, with that person's id (the `sub` claim) in it, and invokes the function that serves the route (`smart-finances-<stage>-api-read`, `-api-write` or `-api-delete`) with your own AWS profile. No sign-in is involved, so use it only with the stage's test users. It runs on qa and staging only, never prod, and `DELETE /data` also needs `--yes`. It prints the status and the reply body.

```bash
AWS_PROFILE=<profile> node scripts/api-call.mjs --stage staging --as <sub> GET '/transactions?from=2026-01&to=2026-12'
AWS_PROFILE=<profile> node scripts/api-call.mjs --stage staging --as <sub> PUT /rates/2026-05 '{"ars_per_usd":1000}'
AWS_PROFILE=<profile> node scripts/api-call.mjs --stage staging --as <sub> --upload data/synthetic/transactions.csv
```

`--upload` asks `POST /imports` for an upload form (source `csv` unless the JSON names another), posts the file to it, and prints the import id to follow with `GET /imports/{id}`.

After the first deploy that adds the table's change stream (data PR 3), run a rebuild once for each person who imported data before it. Rows written before the stream existed have no month totals until then. Then check that `GET /totals` lists their months:

```bash
AWS_PROFILE=<profile> node scripts/api-call.mjs --stage qa --as <sub> POST /totals/rebuild
AWS_PROFILE=<profile> node scripts/api-call.mjs --stage qa --as <sub> GET '/totals?from=2026-01&to=2026-12'
```
