# Approved-policy change requests

This subsystem lets the originating employee or producer request review of an
approved policy without copying or mutating that policy. Requests contain only
a bounded reason. Admin resolution is either no-change, send-back, or a
correction of the original policy through the existing audited general or
override path.

Entry points:

- `service.ts` owns transactional creation, listing, and resolution.
- `projection.ts` defines the separate owner and admin response allowlists.
- `../http/policy-change-requests.ts` registers every route with an explicit
  owner or admin authorization declaration.
- `../../drizzle/0043_policy_change_requests.sql` owns storage and trusted
  lifecycle functions.

Verification:

```sh
npm run check
npm test
npm run test:db:policy-change-requests
npm run db:verify:migrations
```
