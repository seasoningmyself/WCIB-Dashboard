# KPI actuals contract

Historical KPI actuals have one source: `pay_sheet_policies.frozen_policy_snapshot`
joined to a `pay_sheets` row whose status is `closed`. The application must not
read `policies`, drafts, approval rows, open sheets, or pay-sheet adjustments as
a fallback. The reusable entry point is `server/kpi/closed-facts.ts`.

## Scope queries

- Company facts use closed Sophia sheets. Every settled policy appears there
  once; including producer sheets would double-count assigned policies.
- Producer facts use closed producer sheets filtered by `owner_user_id` UUID.
- Annual scope uses `period_year`. Quarterly or other period scope supplies the
  applicable `period_month` values.
- An open sheet never contributes a historical fact.

The Milestone 3 endpoint must guard company scope as admin-only. Producer scope
may be read by an admin or by that active producer for their own UUID. Employees
have no KPI access. Endpoint output must still use `projectAuthorizedFields`;
this repository is an internal source contract, not an authorization boundary.

## Derivation

| Actual or dimension | Frozen source |
| --- | --- |
| New-policy count | Count snapshots where `transactionType` is exactly `New` |
| New revenue | Sum `agencyRevenue` for those `New` snapshots |
| Retention numerator | Count snapshots whose `transactionType` is not `New` |
| Retention denominator | Count all in-scope snapshots |
| Retention rate | Round `100 * numerator / denominator`; use 0 when empty |
| Won Back | Count the direct `transactionType` value `Won Back` |
| Producer scope | Sheet `owner_user_id`; snapshot `producerUserId` is a dimension |
| Office | `officeLocationId` |
| Policy type and class | `policyTypeName`, `policyTypeClass` |
| Time | Sheet year/month plus snapshot `effectiveDate` and `approvedAt` |
| Other measures | `agencyRevenue`, `producerPayout`, and `sophiaShare` |

`Won Back` remains its own transaction type. It is not a rewrite subtype. Under
the v15 rule that only `New` is new business, Won Back contributes to the
retention/existing numerator while remaining separately countable by type.

Money stays in canonical two-decimal strings at the snapshot boundary and is
converted to integer cents for aggregation. Snapshot values must never be
written to logs; later query logs may contain only scope, year, and row count.

Closed snapshots are immutable. A later edit to the live policy cannot change a
historical KPI result, and no KPI actuals table or materialized cache is stored.
