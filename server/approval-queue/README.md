# Approval queue projection contract

The submitted snapshot contains PII and financial data. Future admin queue
routes must use `projectAuthorizedFields` with
`projectAdminApprovalQueueEntry`. Staff-facing status routes must use the
separate `projectOwnApprovalStatus` projector, which is owner-only and never
returns the payload, action reason, or actor metadata.

Neither projector is a substitute for an explicit route guard and scoped
query. Queue payloads and action reasons must never be written to request logs.

`GET /api/approvals` is the admin work-list entry point. Pending submissions
come from `approval_queue_entries` and use `projectAdminApprovalQueueEntry`.
Flagged help requests are separate `drafts` records and use the admin branch of
`projectDraftForAuthorizedContext`; the API never manufactures queue rows for
them. Use `npm run test:db:approval-work` for the migrated-database contract.

Approval actions are split by trusted source. Pending queue approval accepts an
empty body and parses the immutable `submitted_payload`. Flagged help uses
separate push-through and open-fix routes; both lock the stored draft and call
the existing admin-direct lifecycle without creating a queue row. Open-fix
merges only the established draft allowlist and leaves the original flagged
content intact as the approved policy's source record.
