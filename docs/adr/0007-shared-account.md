# 0007: Stay in the shared AWS account

Status: accepted, 2026-10-28

## Context
The project deploys into an AWS account that other projects also use. Real financial data is about to be stored there. A separate account per project is the usual isolation boundary, but moving now means a new account, a new bootstrap and new deploy roles before any feature exists.

## Decisions
- **D-10**: The data stays in the current shared AWS account; a budget alarm is added before real data is loaded.

## Options
- **Move to a separate AWS account before real data is loaded**: the strongest isolation; costs an account move and new setup now.
- **Stay in the shared account and add a budget alarm** (chosen): no account move or new setup now.
- **Do nothing**: shared account, no budget alarm.

## Decision
Stay in the shared account. A budget alarm is a human step that must exist before the first real upload.

## Accepted risk
- Anything with administrator rights in the shared account, including the deploy roles of other projects, can read this data.
- Anyone with invoke rights on the functions in the account can call a function directly, past the API's JWT authorizer.
- Moving later is a data migration. Recorded in the threat model.

## Consequences
- Per-person isolation inside the stores is enforced in code, not by the account boundary.
- Cost runaway is caught by the budget alarm and the API throttling, not by a separate bill.

## Revisit when
- More than one real person stores data, or another project in the account gains broad roles.
- Customer-managed keys arrive (Epic 6): key policies can then narrow who reads the data.
