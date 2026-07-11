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

`GET /api/drafts` is the My Drafts boundary. Its SQL always starts with the
authenticated `owner_user_id`, optionally adds one approved status filter, and
orders by most recent edit. Admin's My Drafts remains admin-owned; all-user
review belongs to the approval workflow. Run `npm run test:db:draft-list` for
the ownership and ordering boundary.

`PATCH /api/drafts/:draftId` edits only the authenticated UUID's `draft` or
`sent_back` record. The transaction locks and re-reads the owned row, validates
the merged content, and uses the existing lifecycle transition when reopening
sent-back work. Submitted, flagged, and approved drafts remain immutable through
this endpoint. Run `npm run test:db:draft-edit` for ownership, lifecycle, and
atomic rollback coverage.

`POST /api/drafts/:draftId/submit` accepts no policy payload. It locks the
authenticated UUID's persisted draft, validates the complete v15 record, and
builds the immutable queue snapshot or admin policy input on the server. Staff
submission returns a nonfinancial `submitted` projection; admin-owned drafts go
directly to the ledger through the existing audited lifecycle transaction. Run
`npm run test:db:draft-submit` for replay, concurrency, audit rollback, and
queue/ledger mapping coverage.

`POST /api/drafts/:draftId/flag` is employee/producer-only. It requires a
trimmed reason, locks the authenticated UUID's active draft, and delegates the
status change and audit event to `flagDraftForHelp`. The existing lifecycle
contract creates no approval-queue row for help flags. Run
`npm run test:db:draft-flag` for ownership, replay/concurrency, and audit
rollback coverage.

PostgreSQL migration `0013_draft_integrity` owns status transitions and stale
state checks through `transition_draft_status`. Direct status updates are
rejected. Financial values, insured/contact fields, and transition reasons must
never be written to application logs.
