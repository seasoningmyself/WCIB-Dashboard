# Draft access contract

`projection.ts` is the single application-level decision point for draft row
scope and the client-confirmed employee/producer own-active-draft financial
rule. Authenticated routes must first query by the authenticated user's UUID
(unless the trusted principal has the admin capability), then call
`projectAuthorizedFields` with `projectDraftForAuthorizedContext`. A `null`
projection is an access denial, not an empty successful record.

`POST /api/drafts` creates a clean draft owned by the authenticated UUID. Its
strict request contract rejects owner, lifecycle, link, payout, and other
server-managed fields. The response includes the computed carrier-to-agency
commission for the active editor but never a producer's personal rate or
payout. Run `npm run test:db:draft-create` against a migrated disposable local
PostgreSQL target for the persistence boundary.

PostgreSQL migration `0013_draft_integrity` owns status transitions and stale
state checks through `transition_draft_status`. Direct status updates are
rejected. Financial values, insured/contact fields, and transition reasons must
never be written to application logs.
