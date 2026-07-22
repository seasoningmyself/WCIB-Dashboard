# Backup and restore scope

Settings -> Back up & restore is deferred to a separately approved feature and
security design. Core Schema contains no backup, export-job, staging, import,
restore, storage, encryption, endpoint, or UI implementation.

This deferral applies to portable backup/export artifacts. Parent M adds a
separate, database-local Start Fresh recovery mechanism: transactional rows are
retained in sealed business-state generations and restored by a verified active
pointer change. It creates no downloadable artifact, external storage, import
path, credential copy, or cross-database restore mechanism. See
`BUSINESS_STATE_GENERATIONS.md`.

A future backup is a complete financial and PII export. It must be admin-only,
encrypted in transit and at rest, retained for an explicitly approved period,
and logged without payload values. The design must preserve UUID identity,
credential confidentiality, actor references, rate locks, append-only audit
history, closed snapshots, and all financial field-visibility rules.

## Dependency-safe restore order

The future implementation must restore in this order:

1. `users`.
2. `staff_profiles`, `user_capabilities`, and `producer_rate_history`.
3. Controlled vocabularies: `office_locations`, `mgas`, `carriers`, and
   `policy_types`.
4. `drafts` and `approval_queue_entries`.
5. `policies`.
6. `policy_change_requests`, `audit_events`, `policy_overrides`, and `mga_payments`.
7. `pay_sheets` and `pay_sheet_policies` frozen policy/rate snapshots.
8. `pay_sheet_adjustments`.
9. `kpi_targets`.

Authentication-owned MFA rows depend on users. Start Fresh preserves MFA
settings, methods, passkeys, encrypted TOTP secrets, recovery codes,
challenges, recovery grants, and step-up authorizations because it resets only
business-generation data. A future portable backup review must explicitly
decide whether credential and transient-session state belongs in an artifact;
the default remains to omit transient challenges, grants, step-up approvals,
reset tokens, and active sessions and force reauthentication after restore.

## Integrity rules

- Preserve every UUID. Never reconstruct ownership from display names.
- Keep foreign keys enabled. Domain and financial relations use restrictive
  deletes; cascade is limited to identity-owned reset/MFA rows.
- The audit `entity_id` is an immutable polymorphic UUID locator rather than a
  live ownership link. `actor_user_id` remains a real user foreign key.
- JSONB fields are bounded payloads or frozen snapshots, not arrays of live
  relationship identifiers. Draft history is bounded event history.
- Preserve producer-rate `locked_at` values exactly. Never recalculate a rate
  already snapshotted onto a closed pay sheet.
- Preserve closed pay-sheet totals, policy snapshots, rate snapshots, close
  actor, and close timestamp exactly. Do not regenerate history from policies.
- Preserve audit events and overrides append-only. Backout must never delete
  restored financial or audit history.

## Staged lifecycle load

Drafts, approval queue entries, and policies form a validated lifecycle cycle:
drafts hold linked queue/policy UUIDs, queue entries reference drafts, and
policies may reference their source draft. The three lifecycle consistency
triggers are `DEFERRABLE INITIALLY DEFERRED`.

A future restore must load each lifecycle set inside one transaction in steps
4-5, retain the original IDs and final statuses, and let the deferred checks run
at commit. It must not disable triggers or constraints.

Closed pay-sheet writes also require trusted functions. A future restore needs
a separately reviewed, narrowly scoped trusted procedure that can stage parent
and child rows while preserving the original frozen values. It must not reopen
history, call normal close logic to recalculate old sheets, or disable closed
immutability. No such bypass or procedure exists in Core Schema.

## Current review result

The schema has no SQL array relationship columns, no name-based foreign key, no
orphaning domain cascade, and no backup/export/staging table. Portable backup
and cross-database restore remain intentionally unimplemented. Start Fresh
generation recovery is not a substitute for managed Postgres backups or a
future encrypted export/restore feature.
