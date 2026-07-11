# Policy projection contract

Policies contain stored PII and agency financial data. No route may serialize a
database row directly. The general ledger projection is default-deny and
`projectAdminPolicy` returns an explicit full allowlist only to an active admin
principal through `projectAuthorizedFields`.

Producer `My Commissions` and role-universal `My Drafts` are separate
feature-specific projections. They must not broaden this general ledger
contract. Policy rows, insured names, finance contacts, and monetary values
must never be logged.

The payment-tracking shape is inert. Only its four true numeric inputs, two
statuses, and due date are stored. Read models compute
`balance_due_from_insured = premium_total - collected_to_date` and
`remaining_net_due = net_due_total - remitted_to_mga`; neither balance is a
database column.

## Draft-to-ledger lifecycle

`lifecycle.ts` is the transaction boundary for draft submission, flagging,
send-back, queued approval, and admin direct entry. Actor IDs and queue bypass
come only from `AuthorizedRequestContext`; policy identity, timestamps, MGA
payment state, IPFS push state, and the inert payment-tracking stub are set by
the service. The database functions recheck active staff/admin access and
deferred constraints reject partial draft, queue, and policy states at commit.

Run the fast contract tests with `npm test`. After applying migrations to a
disposable database, run `npm run test:db:policy-lifecycle` for the full atomic
lifecycle and rollback coverage.

## Override value contract

`override-values.ts` accepts only the four figures exposed by v15's override
panel: commission amount, broker fee, net due, and commission mode. Callers
must name each changed field; the builder emits matching, bounded original and
replacement objects and rejects unchanged, missing, malformed, or extra data.
These objects are confidential admin-only financial data and must never be
logged or returned through a non-admin projection.
