# Migration safety and backout runbook

This runbook covers the Core Schema migration chain. It does not authorize a
production migration by itself. The operator must complete the preflight,
confirm a recoverable DigitalOcean checkpoint, and stop on any mismatch.

## Safety model

- `npm run db:migrate` uses the dedicated migration URL when present, obtains a
  session advisory lock, and runs Drizzle's pending SQL and history inserts in
  one PostgreSQL transaction.
- Every current forward and backout statement is valid inside a transaction.
  CI rejects known nontransactional forms such as concurrent index creation,
  enum value addition, `VACUUM`, and database creation/deletion. A future
  migration needing one of those forms requires its own reviewed recovery
  procedure before merge.
- `npm run db:verify:migrations` accepts only local Docker hostnames. It creates
  a disposable PostgreSQL 18 database, applies all migrations, checks history,
  rolls everything back, compares the clean schema fingerprint, reapplies, and
  compares the final fingerprint. Its output records only safe phase/tag names,
  pass status, elapsed milliseconds, and a sanitized database error code.
- The same verifier injects a failure after the SQL and history write for a
  representative table, function, trigger, and constraint migration. The
  transaction must restore both schema and history to the exact pre-state.
- Backout SQL is a pre-data/disposable recovery tool unless the inventory says
  otherwise. Once business, identity, audit, or financial rows exist, preserve
  them and use a reviewed forward-fix. Use point-in-time recovery only when the
  incident requires restoring the entire database to a known checkpoint.

## Preflight

1. Confirm the commit and migration inventory intended for release.
2. Run `npm ci`, `npm run check`, `npm test`, `npm run db:check`, and
   `docker compose run --rm --build app npm run db:verify:migrations`.
3. Confirm the application deploy is stopped or unable to perform writes for
   migrations that alter live invariants.
4. Confirm `DATABASE_MIGRATE_URL` names `wcib_migrator`, the private VPC host,
   database `wcib`, and `sslmode=verify-full`. Never print the URL.
5. Confirm the runtime account remains `wcib_runtime`; it must not own or apply
   schema migrations.
6. In DigitalOcean, confirm automated backups are healthy and record the exact
   pre-migration UTC timestamp for the point-in-time recovery checkpoint.
7. Record row counts for populated identity, policy, audit, MGA payment, and
   pay-sheet tables. Do not proceed if they are unexpectedly zero or changed.
8. Run a read-only history check and confirm it matches the journal through the
   last previously deployed migration.

## Apply and verify

Run exactly one migration process:

```sh
NODE_ENV=production npm run db:migrate
```

Then run `npm run db:check`, query the migration history count/latest timestamp,
and exercise `/ready`. Compare the protected table row counts with preflight.
Do not run the disposable verifier against DigitalOcean; it refuses that host.

## Stop conditions

Stop the release without retrying when any of these occurs:

- migration history and the committed journal disagree;
- the advisory lock cannot be obtained in the release window;
- any SQL statement or post-apply verification fails;
- expected rows disappear, protected counts change unexpectedly, or a closed
  pay-sheet/audit invariant no longer holds;
- the backup/PITR checkpoint cannot be confirmed;
- the connection identifies the wrong host, database, or role.

PostgreSQL transaction failure leaves the migration batch and its history
inserts unapplied. Capture sanitized error codes and schema/history evidence;
never paste connection strings, credentials, financial values, or PII into
logs or tickets.

## Recovery decision

Use a reviewed backout only before the affected schema has stored real data and
only in reverse dependency order. Each backout and matching history deletion
must be one transaction under the migration lock. Re-run the forward migration
only after schema and history agree.

Use a forward-fix when rows, audit history, closed pay sheets, rate snapshots,
or identity/access records exist. A forward-fix gets a new numbered migration;
never edit an applied migration and never reopen or rewrite financial history.

Use DigitalOcean point-in-time recovery when a failed release corrupts or
deletes data and a forward-fix cannot preserve correctness. Restore to a new
managed cluster at the recorded pre-migration timestamp, verify it privately,
then perform a controlled connection cutover. Do not overwrite the source
cluster while evidence or recovery validation is incomplete.

## Migration inventory

Forward SQL is `drizzle/<tag>.sql`; reverse SQL is
`drizzle/backout/<tag>.sql`. Dependencies name the immediately relevant schema
owners, not every transitive predecessor.

| Migration | Owns or changes | Depends on | Backout/data-loss class |
| --- | --- | --- | --- |
| `0000_baseline` | No-op baseline | None | Reversible no-op |
| `0001_users` | User identity and credentials | `0000` | Unused-only; refuse populated identities |
| `0002_staff_accounts` | Staff profiles, capabilities, role/pronoun enums | `0001` | Unused-only; refuse access data |
| `0003_sessions` | Server sessions | `0001` | Explicit transient-state invalidation |
| `0004_password_reset_tokens` | Reset tokens | `0001` | Explicit credential-state invalidation |
| `0005_mfa_scaffold` | Inert MFA settings/placeholders | `0001` | Unused-only; refuse security rows |
| `0006_producer_rate_history` | Dated producer rates | `0002` | Unused-only table drop; forward-fix after rates exist |
| `0007_producer_rate_integrity` | Rate lock functions and trigger | `0006` | Guard removal only; forward-fix after rate use |
| `0008_office_locations` | Office vocabulary | `0000` | Unused-only table drop |
| `0009_mgas` | MGA vocabulary | `0000` | Unused-only table drop |
| `0010_carriers` | Carrier vocabulary | `0000` | Unused-only table drop |
| `0011_policy_types` | Policy-type vocabulary and class enum | `0000` | Unused-only table/type drop |
| `0012_drafts` | Drafts and turn-in enums | `0001`, `0002`, `0008`-`0011` | Unused-only; destructive after drafts exist |
| `0013_draft_integrity` | Draft transition function and trigger | `0012` | Guard removal only; forward-fix after use |
| `0014_approval_queue` | Queue table, status enum, integrity trigger | `0012`, `0001` | Unused-only; destructive after submissions |
| `0015_policies` | Ledger policy core | `0012` enums | Unused-only; destructive after approval |
| `0016_policy_payment_stub` | Inert payment-tracking inputs/statuses | `0015` | Column/type removal; forward-fix after policy use |
| `0017_audit_events` | Append-only audit event table/enums | `0001` | Unused-only; never drop recorded audit rows |
| `0018_audit_integrity` | Trusted audit writer and append-only trigger | `0017` | Guard removal only; forward-fix after use |
| `0019_policy_references` | Seven restrictive policy foreign keys | `0015`, `0001`, `0002`, `0008`-`0012` | Constraint removal only; forward-fix after use |
| `0020_policy_lifecycle` | Draft/queue/ledger transaction functions | `0013`-`0019` | Guard/function reversal; forward-fix after lifecycle use |
| `0021_policy_overrides` | Financial override history | `0015`, `0001` | Unused-only; never drop override history |
| `0022_policy_override_integrity` | Trusted override path and financial checks | `0021`, `0018` | Guard/check reversal; forward-fix after overrides |
| `0023_mga_payments` | Normalized MGA payment state | `0015`, `0001` | Unused-only; never drop settlement state |
| `0024_mga_payment_rules` | Audited MGA payment transition path | `0023`, `0018` | Guard/check reversal; forward-fix after payment use |
| `0025_pay_sheets` | Monthly pay-sheet parents and frozen totals | `0001` | Unused-only; never drop financial history |
| `0026_pay_sheet_policies` | Policy/rate snapshots on sheets | `0025`, `0015`, `0006` | Unused-only; never drop snapshots |
| `0027_mga_pay_sheet_attachment` | Attach/detach function and open-sheet rules | `0023`-`0026`, `0018` | Guard removal only; forward-fix after placement |
| `0028_pay_sheet_close` | Atomic close function | `0025`-`0027`, `0007`, `0018` | Function removal only; never reopen history |
| `0029_closed_pay_sheet_immutability` | Closed parent/child write guards | `0025`, `0026`, `0028` | Guard removal only before any close |
| `0030_pay_sheet_single_settlement` | Single-settlement owner-chain guards | `0025`, `0026`, `0029` | Guard removal only before settlement |
| `0031_pay_sheet_adjustments` | Audited next-sheet corrections/income | `0025`, `0029`, `0011`, `0001`, `0002` | Refuses populated rows; forward-fix after use |
| `0032_kpi_targets` | Company/producer KPI targets | `0002` | Refuses populated rows; forward-fix after use |
| `0033_policy_corrected_audit_action` | Dedicated general policy-correction audit action | `0018`, `0020` | Pre-use enum reversal only; forward-fix after the action is recorded |
| `0034_policy_correction` | Audited allowlisted policy-correction function and direct-write guard | `0020`, `0022`, `0033` | Pre-use function/guard removal only; forward-fix after a correction |
| `0035_vocabulary_creation_audit_vocabulary` | Dedicated carrier, policy-type, and MGA creation audit values | `0018`, `0034` | Pre-use enum reversal only; forward-fix after any new value is recorded |
| `0036_flagged_help_resolution` | Audited admin send-back and owner-withdrawal transitions for flagged drafts | `0013`, `0018`, `0020`, `0035` | Refuses reversal after either resolution action records audit history; forward-fix after use |
| `0037_producer_commission_received` | Nullable producer commission-receipt timestamp on canonical policies | `0015`, `0036` | Refuses reversal after any receipt timestamp is recorded; forward-fix after use |
| `0038_producer_commission_receipt_audit_actions` | Explicit producer commission receipt mark/unmark audit vocabulary | `0018`, `0036`, `0037` | Refuses reversal after either action records audit history; forward-fix after use |
| `0039_pay_sheet_initialization` | Audited first-owner-chain initialization and lazy producer-sheet placement wrapper | `0018`, `0025`-`0030`, `0038` | Refuses enum reversal after initialization audit history exists; forward-fix after any chain is initialized |
| `0040_pay_sheet_cascade_close` | Atomic House-sheet cascade close and independent open-period placement after opt-out | `0027`-`0030`, `0039` | Restores prior placement functions and removes cascade orchestration; forward-fix after owner periods diverge |
| `0041_pay_sheet_chargeback_mirrors` | Atomic House chargeback normalization and read-only producer-sheet mirrors | `0031`, `0039`, `0040` | Refuses linkage loss while mirrors exist; forward-fix after mirror use |
| `0042_submitted_draft_withdrawal` | Audited owner withdrawal of still-pending submitted drafts with preserved queue snapshots | `0013`, `0018`, `0020`, `0041` | Refuses enum reversal after withdrawal history exists; forward-fix after use |
| `0043_policy_change_requests` | Reason-only owner requests linked to canonical policies with audited admin resolution | `0018`, `0020`, `0034`, `0042` | Refuses reversal after request or audit history exists; forward-fix after use |
| `0044_policy_soft_delete` | Recoverable audited policy deletion, live-view exclusion, open-sheet detach, and deleted-policy attachment guards | `0018`, `0024`, `0027`-`0030`, `0034`, `0040`, `0043` | Refuses deletion-state loss while any policy remains deleted; forward-fix after use |
| `0045_policy_soft_delete_guard_hardening` | Security-invoker enforcement for trusted policy delete/restore transaction context | `0044` | Refuses guard weakening after deletion audit history exists; forward-fix after use |
| `0046_approval_work_soft_delete` | Recoverable audited soft-delete/restore for pending submissions and flagged help drafts, with live-read exclusion | `0013`, `0014`, `0018`, `0020`, `0045` | Refuses deletion-state or audit-vocabulary loss while deleted work or its audit history exists; forward-fix after use |
| `0047_business_state_generations` | Recoverable Start Fresh generations, active-pointer reset/restore, checksummed manifests, and generation-scoped transactional reads/writes | `0013`-`0015`, `0018`, `0020`-`0034`, `0039`-`0046` | Refuses backout after any reset/restore history; sealed generations are immutable and require a forward-fix after use |
| `0048_ipfs_pushed_audit_actions` | Audited IPFS pushed/unpushed state plus v15-compatible completion tracking for manual IPFS agreements | `0015`, `0017`, `0018`, `0044`, `0047` | Refuses audit-vocabulary or constraint backout after pushed-state audit history exists; preserve history and forward-fix |
| `0049_vocabulary_management_audit_actions` | Audited recoverable deactivation/reactivation for carrier, MGA, and policy-type vocabulary | `0017`, `0018`, `0035`, `0047`, `0048` | Refuses audit-vocabulary backout after vocabulary state history exists; preserve history and forward-fix |
| `0050_owner_draft_soft_discard` | Owner-only audited soft-discard plus admin recovery for active drafts | `0012`, `0018`, `0046`, `0047` | Refuses function removal after an owner draft is discarded or its audit history exists; preserve history and forward-fix |
| `0051_remove_staff_pronoun` | Removes the unused staff pronoun column and enum; advances the generation schema contract | `0002`, `0047`, `0050` | Recreates the enum and column with the neutral default; removed pronoun values are intentionally not recoverable |

## Dependency-safe full reverse order

For a disposable or confirmed-empty database only, execute backouts from
`0051` down through `0000`, deleting the matching Drizzle history row in the
same transaction as each backout. The automated verifier is the reference
implementation. There is intentionally no production `db:rollback` command:
an operator must make and document the recovery decision rather than invoke a
generic destructive path.
