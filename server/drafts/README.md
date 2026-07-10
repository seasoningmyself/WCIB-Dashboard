# Draft access contract

`projection.ts` is the single application-level decision point for draft row
scope and the pending employee financial-visibility rule. Future authenticated
routes must first query by the authenticated user's UUID (unless the trusted
principal has the admin capability), then call `projectAuthorizedFields` with
`projectDraftForAuthorizedContext`. A `null` projection is an access denial,
not an empty successful record.

PostgreSQL migration `0013_draft_integrity` owns status transitions and stale
state checks through `transition_draft_status`. Direct status updates are
rejected. Financial values, insured/contact fields, and transition reasons must
never be written to application logs.
