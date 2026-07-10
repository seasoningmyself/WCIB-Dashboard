# Audit events

`audit_events` is the durable, admin-sensitive record for approved financial
and account mutations. Each event identifies the actor, action, entity, and
time, with optional before/after summaries.

Callers must construct summaries with `projectAuditSummary`, passing an
explicit allowlist for that mutation. The projector accepts scalar values only,
blocks credential-like keys, limits strings and field count, and enforces the
same 16 KiB ceiling as the database. Do not log summary payloads.

Append-only enforcement and the trusted mutation contract are added by the
next schema migration. Run `npm test` for projector and migration checks; run
`npm run test:db:audit-events` against migrated Postgres for the database smoke
test.
