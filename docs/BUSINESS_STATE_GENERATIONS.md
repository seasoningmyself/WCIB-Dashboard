# Business-state generations

Start Fresh is a recoverable, database-local generation switch. It never
deletes or reinserts transactional rows and never replaces managed Postgres
backups. Entry points are the admin Settings panel and the guarded
`/api/admin/business-state` routes. Migration `0047` owns the storage, trusted
reset/restore functions, immutable-generation guards, and relationship checks.

## Scope

The following tables carry an immutable `business_generation_id` and are
included in each generation manifest:

1. `drafts`
2. `approval_queue_entries`
3. `policies`
4. `policy_change_requests`
5. `policy_overrides`
6. `mga_payments`
7. `pay_sheets`
8. `pay_sheet_policies`
9. `pay_sheet_adjustments`
10. `kpi_targets`

Accounts, staff profiles, capabilities, producer rates, sessions, offices,
vocabularies, password/MFA records, and audit events are global survivors.
Audit remains append-only. KPI targets are generation-scoped but copy forward
unless reset explicitly requests that they be cleared.

## Live read boundaries

Every live read of a resettable table must include
`inActiveBusinessGeneration(...)`. The current inventory is:

| Surface | Production modules | Generation-scoped facts |
| --- | --- | --- |
| Turn-In, draft cap, My Drafts | `server/drafts/create.ts`, `edit.ts`, `flag.ts`, `list.ts`, `submit.ts`, `withdraw-help.ts`, `withdraw-submission.ts` | drafts and linked queue state |
| My Items | `server/drafts/my-items.ts` | owner drafts/status only |
| Approval queue and actions | `server/approval-queue/list.ts`, `approve.ts`, `approve-with-override.ts`, `send-back.ts`, `soft-delete.ts` | queue, drafts, resulting policy |
| Policy lifecycle | `server/policies/lifecycle.ts` | queue and source draft transitions |
| Ledger and corrections | `server/policies/ledger.ts`, `ledger-corrections.ts` | policies and override targets |
| MGA payables and placement | `server/policies/mga-payables.ts`, migration-scoped MGA trusted functions | policy, payment, open-sheet placement |
| Pay sheets and live KPI widget | `server/pay-sheets/read.ts`, `adjustment-target.ts`, migration-scoped close/adjustment functions | sheets, associations, adjustments, live totals |
| Pay-sheet exports | `server/http/pay-sheet-exports.ts` through `server/pay-sheets/read.ts` | the same projected sheet facts as the screen |
| My Commissions and receipts | `server/commissions/read.ts`, `receipts.ts` | active policy/queue and active-generation frozen associations |
| KPI targets and actuals | `server/kpi/targets.ts`, `closed-facts.ts`, `actuals.ts` | targets and closed sheets in the active generation |
| Approved-record change requests | `server/policy-change-requests/service.ts` | request and linked policy |
| Policy deletion/restore | trusted policy functions plus post-mutation ledger reads | active-generation policy and open associations |

Generation-aware unique indexes prevent current rows from conflicting with
sealed history. Deferred relationship triggers require linked transactional
rows to share one generation. Every transactional mutation takes a shared lock
on the singleton control row through the table guard; reset and restore take an
exclusive lock, so a write cannot straddle the pointer change.

## Closed history

Closed sheets in the active generation are read only from their frozen stored
snapshots and remain historical KPI facts. A reset does not alter them; it seals
their generation and removes that generation from all live views. The rows and
frozen JSON remain physically present and checksum-protected. Restoring that
generation makes the same UUIDs and byte-identical frozen snapshots visible
again. Closed history from different generations is never mixed into current
totals.

## Reset and restore

Reset requires exact typed confirmation `RESET`. It seals the current manifest,
creates a new generation, optionally copies KPI targets, initializes Sophia's
open sheet through the existing K1 trusted function, records one bounded audit
event, and changes the pointer in one transaction.

Restore requires exact typed confirmation `RESTORE <code>`. It rejects unless
the current generation still matches its baseline checksum and the target's
format, migration count, schema fingerprint, row counts, and checksum all
verify. Restore never merges or overwrites post-reset work. Start Fresh again
first to preserve that work as another recovery point.
