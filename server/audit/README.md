# Audit events

`audit_events` is the durable, admin-sensitive record for approved financial
and account mutations. Each event identifies the actor, action, entity, and
time, with optional before/after summaries.

Callers must construct summaries with `projectAuditSummary`, passing an
explicit allowlist for that mutation. The projector accepts scalar values only,
blocks credential-like keys, limits strings and field count, and enforces the
same 16 KiB ceiling as the database. Do not log summary payloads.

Audit rows are append-only. Later financial transaction functions must call
`record_audit_event` before committing their parent mutation. Application
services must call `writeAuditEventInTransaction` with the same transaction
client and the authorization context produced by the route guard; the helper
does not accept a caller-supplied actor ID. Any audit failure must propagate so
the surrounding transaction rolls back.

Run `npm test` for projector and migration checks. Run
`npm run test:db:audit-integrity` against migrated Postgres for append-only and
atomic rollback coverage.
