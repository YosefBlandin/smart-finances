# 0003: Transaction data store

Status: accepted, 2026-10-20 (access patterns are pinned in ADR 0004, Epic 2)

## Context
About 700 transactions a year for one user, mostly read as monthly and category aggregates. Writes arrive in batches from file imports and must be idempotent. Costs should be near zero when idle.

## Options
- **DynamoDB (on-demand), single table**: IAM-native access, no servers, Streams for rollups.
- **Aurora PostgreSQL Serverless v2**: flexible SQL for ad hoc questions; has a capacity setting and cost floor I would need to verify against current pricing.
- **S3 plus Athena**: cheap analytics, poor fit for interactive reads.

## Decision
DynamoDB on-demand, single-table design, with a Streams-driven rollup Lambda that maintains monthly totals by category.

## Consequences
- Queries must be designed up front; adding a new access pattern later can mean a new index or a data migration.
- No ad hoc joins or aggregates. The assistant's tools must map to known access patterns, which also keeps tools narrow and safe.
- Streams deliver at least once, so rollups must be idempotent.
- Per-function IAM can be scoped to specific tables and key conditions.

## Revisit when
Users ask questions the access patterns cannot answer cheaply, or the rollup logic becomes more complex than the SQL it replaces.
