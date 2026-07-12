# My Commissions

`listMyCommissionSources` scopes approved, in-review, and frozen pay-sheet data
to the authenticated producer UUID before projection. The HTTP route then sends
every item and summary through `projectAuthorizedFields` using the dedicated
producer-only projectors.

Closed payouts come from immutable producer pay-sheet snapshots. Open and
in-review payouts reuse the pay-sheet reader's integer-cents calculation and
effective-rate lookup, but the API exposes only the final payout. A missing rate
is represented as `null`; it is never replaced with a fabricated amount.

Run the focused database contract with:

```sh
npm run test:db:my-commissions
```
