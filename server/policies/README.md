# Policy projection contract

Policies contain stored PII and agency financial data. No route may serialize a
database row directly. The general ledger projection is default-deny and
`projectAdminPolicy` returns an explicit full allowlist only to an active admin
principal through `projectAuthorizedFields`.

Producer `My Commissions` and employee `My Items` are separate feature-specific
projections. They must not broaden this general ledger contract. Policy rows,
insured names, finance contacts, and monetary values must never be logged.

The payment-tracking shape is inert. Only its four true numeric inputs, two
statuses, and due date are stored. Read models compute
`balance_due_from_insured = premium_total - collected_to_date` and
`remaining_net_due = net_due_total - remitted_to_mga`; neither balance is a
database column.
