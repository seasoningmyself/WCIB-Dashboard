# WCIB Dashboard

WCIB Dashboard is the new multi-user application that will replace the
single-file prototype. The application starts from a blank database; prototype
`localStorage` data is not imported.

The authoritative behavior references are `docs/wcib_dashboard_v15.html` and
`docs/README_Engineer_Handoff.md`. Older data-model and permissions documents
are useful history but do not override those sources or the standing project
decisions.

## Current structure

### Backend

- `server/index.ts` is the process entry point. It reads runtime configuration,
  creates the Express application, and starts the HTTP listener.
- `server/app.ts` composes Express middleware and mounts routes. Keep process
  startup and environment reads out of this module so the app remains testable.
- `server/config/environment.ts` loads `.env`, validates all server runtime
  values, and exposes one immutable config object shape. Other modules should
  not read `process.env` directly.
- `server/**/*.test.ts` holds backend tests next to the behavior they cover.

As backend areas are implemented, use these boundaries rather than placing
unrelated helpers in `app.ts`:

- `server/db/` owns the Postgres client, migrations integration, repositories,
  and transaction boundaries.
- `server/auth/` owns credentials, sessions, password reset, role/capability
  evaluation, and reusable route guards.
- `server/security/` owns cross-cutting default-deny policy helpers, audit
  context, and field-projection rules. Financial projection must happen on the
  server before a response is serialized.
- `server/http/` owns shared HTTP concerns such as error middleware, request
  context, and response helpers.
- `server/modules/<domain>/` is the home for a domain's routes, service logic,
  repository queries, and response projections once that domain is built.

Do not create a generic `utils` dumping ground. A helper stays with its owning
module unless at least two real consumers establish a shared boundary.

### Frontend

- `client/index.html` is the Vite HTML entry point.
- `client/src/main.tsx` mounts React and app-wide providers.
- `client/src/App.tsx` is the application shell and future route boundary.
- `client/src/config.ts` validates browser-visible configuration. It must never
  contain secrets.
- `client/src/styles.css` contains the current global baseline. Feature styles
  should stay with their owning feature when those features are introduced.
- `client/src/**/*.test.tsx` and `client/src/**/*.test.ts` hold frontend tests
  next to the behavior they cover.

Future domain UI belongs in `client/src/features/<domain>/`. Reusable visual
primitives belong in `client/src/components/` only after there is a real shared
consumer. Client-side role checks are presentation only; they must mirror, not
replace, server authorization and field projection.

### Shared code

Create `shared/` when the first contract is shared by both server and client.
It is the expected home for transport types, enums, validation schemas, and
pure capability vocabulary. Shared modules must be safe to ship to the browser:
no credentials, server environment access, database clients, password hashes,
or server-only authorization decisions.

Database row types stay in `server/db/`. API response contracts may live in
`shared/`, but server modules remain responsible for projecting each response
to the fields the authenticated role is allowed to receive.

## Local commands

Install the locked dependencies:

```sh
npm ci
```

Start the backend on port 5000 by default:

```sh
npm run dev:server
```

Start the frontend Vite server (port 5173 by default):

```sh
npm run dev:client
```

The client defaults to same-origin `/api` requests. In local development Vite
proxies `/api` to `http://127.0.0.1:5000`; set `WCIB_API_PROXY_TARGET` to change
that local target. See `client/README.md` for the browser configuration rules.

Run all backend and frontend type checks:

```sh
npm run check
```

Run all discovered backend and frontend tests:

```sh
npm test
```

Create a production frontend bundle in `dist/client`:

```sh
npm run build:client
```

Run both development processes without containers with `npm run dev`. Compose is
the preferred runner once Docker is available because it also supplies local
Postgres.

## App image

The repository has one `Dockerfile` for the WCIB app. It installs the locked
dependencies, runs the check/test/client-build commands, and starts the backend
and frontend as the non-root `node` user. Runtime values are not baked into the
image; supply `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV`, and `PORT` through
the container environment.

Build the app image directly with:

```sh
docker build --tag wcib-dashboard .
```

The local Compose file builds its `app` service from this same Dockerfile. It
uses the official Postgres image separately; there is no database Dockerfile.

## Local Compose

Start the two local services and rebuild the app image with:

```sh
docker compose up --build
```

Compose creates exactly two services on the `wcib_local` network:

- `app` runs the backend on `127.0.0.1:5000` and Vite on
  `127.0.0.1:5173`. Its `DATABASE_URL` reaches Postgres at `db:5432`.
- `db` uses the official `postgres:18-alpine` image. Host tools may reach it at
  `127.0.0.1:54322`.

The first start creates a blank `wcib` database. No prototype data is loaded.
To start only Postgres and confirm its readiness:

```sh
docker compose up -d db
docker compose ps db
```

Confirm that the application-owned `public` schema is still empty before the
first migration:

```sh
docker compose exec -T db psql -U wcib -d wcib -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
```

A fresh database returns `0`; Postgres system catalogs are outside the `public`
schema and are intentionally excluded from this check.

Stop the services while preserving local database data with:

```sh
docker compose down
```

The `postgres_data` volume survives normal restarts and `docker compose down`.
Delete that local volume and return to a blank database only when intended:

```sh
docker compose down --volumes
```

This Compose file is local-only. Production runs the same app image with a
DigitalOcean managed Postgres `DATABASE_URL`; it does not run the `db` service.

## Environment configuration

Copy `.env.example` to `.env` for local development. The server requires
`DATABASE_URL` and `SESSION_SECRET`; `NODE_ENV` defaults to `development` and
`PORT` defaults to 5000. `.env` and environment-specific variants are ignored
by git.

Local Compose sets `DATABASE_URL` to the `db` service on the Compose network.
Production injects a DigitalOcean managed Postgres connection string into the
same variable. The application does not choose or hardcode a database host.
DigitalOcean managed Postgres is the production target so financial data has
managed backups and point-in-time recovery; there is no production database
container.

The production resource inventory, network boundaries, secret locations, and
provisioning checks are documented in
[`docs/DIGITALOCEAN_INFRASTRUCTURE.md`](docs/DIGITALOCEAN_INFRASTRUCTURE.md).

`SESSION_SECRET` must contain at least 32 characters. Production also rejects
the example development value. Startup errors identify a missing or invalid
variable but never print its value.

## Database migrations

Drizzle is the migration framework. Schema declarations live in
`server/db/schema.ts`, and generated SQL plus migration metadata live in
`drizzle/`. Domain tables are added only by their owning schema tickets.

Local migration commands use `DATABASE_URL` from `.env`. If
`DATABASE_MIGRATE_URL` is set, migration commands use it instead so a future
deployment can separate schema privileges from runtime privileges. Neither URL
is printed by the configuration helpers.

Generate a migration after changing the schema declaration:

```sh
npm run db:generate
```

Check that committed migration snapshots are internally consistent:

```sh
npm run db:check
```

Apply all pending migrations to the configured database:

```sh
npm run db:migrate
```

The first apply records `0000_baseline`, an intentional `SELECT 1` migration
that creates no application table or data. Re-running `npm run db:migrate` is
safe; Drizzle skips migration entries already present in its history table.
Connection failures report a sanitized database error code without printing the
connection string.

Every migration has reviewed forward and backout SQL. Before any managed
database apply, run the disposable PostgreSQL 18 safety cycle and follow the
preflight/stop conditions in
[`docs/MIGRATION_SAFETY.md`](docs/MIGRATION_SAFETY.md):

```sh
npm run db:verify:migrations
```

The verifier accepts only the local Docker PostgreSQL host. It creates and
drops its own temporary database; it never applies to the configured `wcib`
database or to DigitalOcean.

The managed Core Schema apply and parity evidence are recorded in
[`docs/MANAGED_SCHEMA_DEPLOYMENT.md`](docs/MANAGED_SCHEMA_DEPLOYMENT.md).
Re-run its read-only catalog contract with `npm run db:verify:managed` after a
managed migration.

All commands fail before contacting Postgres when neither database URL is set.

## User identity and credentials

The auth-owned `users` table uses a database-generated UUID identity. It stores
only a normalized unique email, a bcrypt password hash, active state, session
version, and creation time. Display names, staff profiles, roles, capabilities,
password-reset tokens, and MFA structures are deliberately owned by later
tickets and are not columns in this table.

All password creation and reset paths must reuse
`shared/password-policy.ts` and `server/auth/password.ts`; passwords require at
least 12 characters with uppercase, lowercase, numeric, and special characters.
Plaintext passwords and password hashes must never be logged or returned from
normal account reads.

After applying migrations to local Postgres, run the database-backed model
smoke test with:

```sh
DATABASE_URL=postgresql://wcib:wcib_local_password@127.0.0.1:54322/wcib \
  npm run test:db:user
```

## Session handling

Authenticated state is stored server-side in the Postgres `sessions` table.
The signed `wcib.sid` cookie is HttpOnly, SameSite=Lax, expires after seven
days, and is Secure in production. Production also trusts one reverse proxy so
secure cookies work behind the hosting load balancer. Health and readiness
routes are registered before session middleware and remain independent of the
session store.

The stored WCIB auth payload contains only `userId` and `sessionVersion` in
addition to the standard cookie metadata. Login callers must use
`establishAuthenticatedSession`, which regenerates the session ID before
persisting identity. Authenticated lookup resolves the UUID against the current
`users` row and destroys sessions for malformed, expired, deleted, disabled, or
version-mismatched identities. Rejection logs contain a safe reason code only;
they never contain cookies, session IDs, user UUIDs, emails, or credentials.

Foundation sessions do not contain roles, capabilities, financial data,
Dumpster domain fields, or MFA state. The later optional admin 2FA ticket may
add inert pending-verification state without changing the authenticated
identity contract.

After applying migrations, run the Postgres-backed lifecycle smoke test with:

```sh
DATABASE_URL=postgresql://wcib:wcib_local_password@127.0.0.1:54322/wcib \
  npm run test:db:session
```

### Login endpoint

`POST /api/auth/login` accepts `{ "email": string, "password": string }`.
Any unauthenticated client may call it; only valid credentials for an active
account create a session. A successful response contains only the user's UUID,
normalized email, employee/producer `staffRole` or `null`, and approved
capability names. It contains no password state, session version, financial
fields, MFA state, or domain records.

Unknown accounts, wrong passwords, disabled accounts, and an identity removed
during login all return the same HTTP 401 `invalid_credentials` response.
Malformed requests use the shared HTTP 400 validation response. Successful
login regenerates the session ID before returning. Password-only login is the
complete Foundation flow for employees, producers, and admins; optional admin
2FA remains deferred and inert.

Foundation intentionally installs no login rate limiter. The route accepts a
middleware list ahead of its standalone handler so Security Hardening ticket
STONE-33 can add rate limiting without rewriting credential or session logic.

After applying migrations, run the real endpoint smoke test with:

```sh
DATABASE_URL=postgresql://wcib:wcib_local_password@127.0.0.1:54322/wcib \
  npm run test:db:login
```

### Logout endpoint

`POST /api/auth/logout` accepts no body and returns HTTP 204 with no response
fields. Any client may call it: authenticated, anonymous, and already-expired
sessions receive the same idempotent result. The server destroys the current
Postgres session when present and clears only the `wcib.sid` cookie. Requests
that reuse the old cookie are unauthenticated.

Logout has no role, capability, financial, MFA, trusted-browser, or domain-data
branches. Logs contain only `logout_succeeded` or `logout_failed` metadata. If
the session store cannot confirm destruction, the cookie is still cleared and
the route returns the generic HTTP 500 API response rather than claiming that
server-side revocation succeeded.

### Password reset endpoints

`POST /api/auth/password-reset/request` accepts `{ "email": string }` from any
client and always returns HTTP 202 with `{ "status": "accepted" }` for a valid
email shape. Known, unknown, disabled, delivery-failed, and internal processing
outcomes do not change that response. Active users receive a one-hour reset
token through the configured delivery adapter. The database stores only the
SHA-256 token hash, expiry, consumed state, and user UUID.

`POST /api/auth/password-reset/confirm` accepts a 43-character reset token and
a new password. The shared password policy applies to every role. One valid,
unexpired token can update the bcrypt hash exactly once; invalid, expired,
consumed, and concurrently replayed tokens share the HTTP 400
`invalid_reset_token` response. Success returns HTTP 204 with no response
fields, increments `sessionVersion`, consumes sibling tokens, and deletes that
user's active Postgres sessions.

Both endpoints are role-independent and expose no financial, MFA,
trusted-browser, or domain data. Runtime delivery is intentionally unconfigured
during Foundation: the adapter reports a safe delivery failure and the
undelivered token is immediately consumed. A reviewed provider can replace the
adapter without changing token, route, or database logic.

After applying migration `0004_password_reset_tokens`, run:

```sh
DATABASE_URL=postgresql://wcib:wcib_local_password@127.0.0.1:54322/wcib \
  npm run test:db:password-reset
```

### Optional admin 2FA scaffold

Foundation includes schema-only structure for future optional admin 2FA:
`user_mfa_settings` identifies an admin account with a scaffold, and
`user_mfa_method_placeholders` can name `email`, `totp`, or `webauthn` as
future method types. The service creates these records only for users with an
active `admin` capability.

This is not active MFA protection. Database checks require
`enforcement_enabled = false` and `is_enabled = false`; login and session code
do not read either table. Admins with no placeholders and admins with inert
placeholders both use the same password-only Foundation login as employees and
producers. There are no enrollment, challenge, verification, recovery-code, or
trusted-browser routes.

The scaffold stores no secrets, credential IDs, assertions, challenges,
recovery codes, or trusted-browser tokens. Activating any method requires a
separate reviewed ticket to migrate the inert checks, add method-appropriate
encrypted or hashed credential storage, implement challenge services and
routes, update sessions, and add user-facing enrollment and recovery behavior.

After applying migration `0005_mfa_scaffold`, run:

```sh
DATABASE_URL=postgresql://wcib:wcib_local_password@127.0.0.1:54322/wcib \
  npm run test:db:mfa-scaffold
```

## Staff accounts and capabilities

`staff_profiles` is a one-to-one extension of an auth-owned user UUID. Staff
profiles contain the editable display name, employee/producer role, the
her/his/their label used by v15, active state, and creation time. Deactivation
preserves the profile and its UUID relationships.

`user_capabilities` stores normalized explicit capability names by user UUID.
Capabilities can be disabled without deleting the grant. Admin is a capability,
not a staff role, so Sophia can hold `admin` without a `staff_profiles` row.
The tables contain no credential fields and use restrictive foreign keys so a
referenced user cannot be deleted accidentally.

After applying migrations, verify the approved roster and Sophia/admin shapes:

```sh
DATABASE_URL=postgresql://wcib:wcib_local_password@127.0.0.1:54322/wcib \
  npm run test:db:staff
```

### Initial roster seed

`npm run db:seed:roster` creates only the approved blank-slate roster: Kaylee
as producer; Mercedes, Daniela, Joseph, and Ellyscia as employees; and Sophia
with the `admin` capability and no staff profile. It never creates policies,
drafts, ledger entries, pay sheets, financial data, or prototype imports.

The command requires `DATABASE_URL` and a seed-only
`WCIB_SEED_ROSTER_JSON` value. The JSON must contain the keys `kaylee`,
`mercedes`, `daniela`, `joseph`, `ellyscia`, and `sophia`; each value must have
an `email` and a unique temporary `password` satisfying the normal password
policy. Store this value only in the ignored local `.env` or an equivalent
deployment secret. Do not commit it or put production credentials in shell
examples.

The seed keys identity by normalized email and database UUID, never display
name. Exact records are skipped on rerun without changing password hashes.
Conflicting display names, disabled accounts, mismatched staff profiles,
Sophia staff rows, and disabled admin grants fail closed instead of overwriting
recorded state. Output contains created/skipped counts only; it never prints
emails or passwords.

Apply migrations first, then run:

```sh
npm run db:seed:roster
```

Verify idempotency and the exact Postgres shape with:

```sh
DATABASE_URL=postgresql://wcib:wcib_local_password@127.0.0.1:54322/wcib \
  npm run test:db:roster-seed
```

## Role and capability model

WCIB has two staff roles and one approved capability:

- `employee`: may later receive explicit access to own draft entry workflows.
  Under the pending client-confirmation boundary, this role alone never grants
  stored financial reports, derived totals, agency figures, another record's
  money fields, or any other endpoint not explicitly listed.
- `producer`: does not inherit employee or admin access. Later endpoint rules
  may list both staff roles for shared data-entry actions. Producer-only access
  is limited to that producer's own My Commissions workflow; it never implies
  agency-wide or another producer's financial access.
- `admin`: an explicit capability, not a staff role. An active user such as
  Sophia can hold it without a staff profile.

Every protected endpoint must explicitly list the accepted staff roles and/or
capabilities. The server evaluator uses OR composition for listed requirements,
but an empty requirement denies everyone, including admin. Inactive users lose
all access; inactive staff profiles lose their role; inactive and unknown
capabilities are ignored. This keeps future capability strings inert until they
are reviewed and added to the approved vocabulary. Frontend checks may mirror
this model for presentation but cannot enforce it.

The employee financial boundary is intentionally isolated here and in later
server projections so the pending client decision can be adjusted without a
schema change. No feature-specific policy, ledger, pay-sheet, or MGA rules are
implemented by this Foundation model.

Run the database-backed role/capability lookup smoke test with:

```sh
DATABASE_URL=postgresql://wcib:wcib_local_password@127.0.0.1:54322/wcib \
  npm run test:db:access
```

## Authorization middleware

`server/auth/authorization.ts` is the server-side guard entry point for future
protected routes. Build one guard set with
`createDatabaseAuthorizationGuards`, then attach exactly one explicit
`authorization.require(...)` declaration to each protected route. The accepted
requirement is `authenticated`, a list of employee/producer staff roles, a list
of capabilities, or a role/capability combination. Omitting the requirement or
passing empty lists denies every account, including admin.

The guard resolves the server-side session, reloads current user access from
Postgres, and stores only the trusted user UUID, staff role, and capability
summary in request-local authorization context. Client-supplied roles,
capabilities, IDs, or financial values are never consulted. Anonymous requests
receive HTTP 401; authenticated accounts that do not satisfy the explicit rule
receive HTTP 403. Denial logs contain only the route template, method, safe
reason code, and authenticated user UUID when available.

`server/security/field-projection.ts` is the response-projection hook. A route
handler calls `projectAuthorizedFields` with an explicit DTO projector; that
projector receives the trusted authorization context established by the guard.
The helper fails closed before running the projector if the route omitted its
guard. Later endpoint tickets must define the concrete record-scope checks and
field allowlists, return explicit response DTOs, and state in one sentence who
can call the endpoint and which fields its projector returns. Never spread a
database row into an API response.

### Route access declarations

All application routes register through `server/http/routes.ts`. The registrar
requires exactly one access declaration before Express receives the route:

```ts
routes.get(
  "/api/policies",
  { authorization: authorization.require({ capabilities: ["admin"] }) },
  listPolicies,
);

routes.get(
  "/health",
  { public: true, reason: "Infrastructure requires liveness before login" },
  healthCheck,
);
```

Public declarations require a non-empty reason. Authorized declarations accept
only a guard returned by `authorization.require(...)`; the registrar applies
that existing guard before the handler. Missing, conflicting, or unrecognized
declarations stop registration. `createApp` also audits the actual Express
route stack before returning, so a route added directly through Express fails
startup and the route-audit tests.

This declaration layer controls route reachability only. Sensitive-data
handlers must still call `projectAuthorizedFields` with their approved DTO
projection; an authorization declaration never makes a raw database row safe
to return.

## Database connection smoke

The backend creates its runtime `pg` pool from the validated `DATABASE_URL` and
executes `select 1` before opening the HTTP listener. A failed database check
stops startup and logs only a safe driver code.

Run the same round-trip without starting HTTP:

```sh
npm run db:smoke
```

The command uses the normal runtime config path, prints `Database connection
successful`, and closes its pool. Local Compose waits for `db` to become healthy
before starting `app`, so this same check also verifies the `db:5432` network
path when the app container starts.

## Health checks

`GET /health` is a public process-liveness check. It returns only
`{"status":"ok"}` while the HTTP app is running and does not query Postgres.

`GET /ready` is a public readiness check backed by the existing database
connection check. It returns `{"status":"ready"}` with HTTP 200 when Postgres
responds, or `{"status":"unavailable"}` with HTTP 503 when the check is missing
or fails. Neither endpoint returns environment values, connection details,
schema information, record counts, or error messages, and both disable caching.

Check them locally with:

```sh
curl --fail http://127.0.0.1:5000/health
curl --fail http://127.0.0.1:5000/ready
```

## API errors

Every API failure returns `{ "error": { "code", "message", "details"? } }`.
Validation errors may include field/message details; unexpected failures always
return the generic `internal_error` response. The server never returns stack
traces, request bodies, cookies, credentials, or financial payloads.

Unexpected failures emit one safe event containing only the HTTP method, route
template, status code, and error type.

## Policy override integrity

Admin-approved corrections to stored policy financial values use
`applyPolicyOverride`, which calls the database-owned `apply_policy_override`
function. The function locks the policy, reads original values from Postgres,
updates the allowlisted fields, appends an immutable override record, and writes
the audit event in one transaction. Direct override inserts, updates, deletes,
and direct mutations of override-managed policy fields fail at database level.

Run the database-backed integrity check after migrations with:

```sh
npm run test:db:policy-override-integrity
```

Success and failure logs contain only actor, policy, and override IDs. They do
not include reasons, original or replacement values, insured data, or other
financial fields.

## Recoverable policy deletion

Admin policy deletion uses `POST /api/policies/:policyId/soft-delete` with a
required bounded reason. The trusted database function records deletion state,
detaches only open-sheet associations, and appends the audit event atomically.
Deleted records are available only to admin through `GET /api/deleted-policies`
and may be restored through `POST /api/deleted-policies/:policyId/restore`.

Live reads exclude deleted policies. Closed pay-sheet views and historical KPI
actuals continue to read immutable frozen snapshots, so deleting a settled
policy cannot rewrite a closed period. Restoring an unsettled MGA-paid policy
uses the established placement function; restoring a settled policy never
places it on a second sheet.

Run the focused database proof after migrations with:

```sh
npm run test:db:policy-soft-delete
```

## MGA payment state

`mga_payments` stores one current MGA settlement row per policy. Unpaid rows
carry no paid-only metadata; paid rows require a paid timestamp and trusted
admin account UUID, with an optional non-blank reference. Foreign keys retain
the related policy and actor records.

MGA paid/unpaid changes use `setMgaPaymentState`, which delegates to the
admin-validated `set_mga_payment_state` database function. It locks the policy
and current payment row, synchronizes the policy compatibility fields, and
writes the audit event in one transaction. Direct state writes and payment-row
deletes fail at database level. Identical repeated requests retain timestamps
and do not append duplicate audit events. Pay-sheet attachment is deliberately
absent until item 25, after its referenced tables exist.

Run the table-level database check after migrations with:

```sh
npm run test:db:mga-payments
npm run test:db:mga-payment-rules
```

## Pay-sheet records

`pay_sheets` identifies each Sophia or producer sheet by owner UUID and numeric
month/year. Open sheets cannot contain frozen totals or close metadata. When
present, `frozen_totals` is a bounded owner-specific object of canonical money
strings. Common totals retain broker fees, commissions, trust pull,
direct/check/ACH income, and grand total income; producer sheets add payout,
while Sophia sheets separately retain agency gross, share, and take-home.

The application validator enforces `trust = broker fees + commissions`, `grand
total = trust + direct/check/ACH income`, and Sophia agency gross equals grand
total. Policy rows, rate snapshots, adjustments, close behavior, and reopen
behavior are not part of the item-23 table.

Run the table and frozen-total contract checks with:

```sh
npm run test:db:pay-sheets
node --import tsx --test server/pay-sheets/frozen-totals.test.ts
```

`pay_sheet_policies` normalizes each sheet/policy association. Open rows may
carry only their source UUIDs; close workflows later populate a self-contained
policy snapshot and, for producer payouts, a source rate UUID plus copied rate
snapshot. The policy snapshot contains the display identity, KPI dimensions,
UUID ownership dimensions, exact commission/broker/revenue/payout/share values,
and no carrier fee or rewrite subtype. Agency revenue is derived by the builder
instead of trusted from a caller.

Snapshot builders use fixed allowlists and ignore unknown source fields rather
than spreading ORM rows. Run their contract and database checks with:

```sh
node --import tsx --test server/pay-sheets/snapshots.test.ts
npm run test:db:pay-sheet-policies
```

MGA placement runs only after the item-22 paid/unpaid state is synchronized.
The trusted `sync_mga_payment_sheet_placement` function derives the one open
Sophia sheet and matching assigned-producer sheet; callers cannot supply sheet
or owner IDs. Paid calls skip owner chains already represented on a closed
sheet. Unpaid calls delete open associations only, and every actual attachment
or detachment writes its own bounded audit event atomically.

Partial unique indexes allow one global open Sophia sheet and one open sheet per
producer. The function also locks the policy/MGA rows and uses the existing
sheet-policy unique key with `ON CONFLICT DO NOTHING`, making repeated and
competing placement requests duplicate-safe. Run the database contract with:

```sh
npm run test:db:mga-pay-sheet-attachment
```

Pay-sheet close is one database transaction exposed through
`close_pay_sheet(sheet UUID, actor UUID)`. The function derives all snapshots
and totals from locked database rows, uses the producer rate effective on the
UTC close date, locks that rate, records the bounded close audit, and creates
the next owner period. It is idempotent after a successful close and never
reopens or recalculates closed history. December advances to January of the
next year.

At item 26, frozen totals begin with policy-derived commission and broker-fee
values. Item 29's close trigger now folds locked normalized adjustment and
direct-income rows into those totals in the same close transaction. Run the
close contract with:

```sh
npm run test:db:pay-sheet-close
```

Closed-sheet immutability is enforced below the application layer. A narrowly
scoped parent trigger rejects any update statement naming `status`,
`frozen_totals`, `closed_at`, or `closed_by_user_id` after close, while leaving
unrelated columns outside that trigger. Every `pay_sheet_policies`
insert/update/delete takes a share lock on its parent and fails when that parent
is closed. The same parent-status helper is the intended guard for item 29's
adjustment rows. Run the direct-SQL boundary tests with:

```sh
npm run test:db:closed-pay-sheet-immutability
```

Single settlement is scoped to `(policy UUID, owner UUID, owner type)`, so one
policy can legitimately settle once on Sophia's chain and once on its assigned
producer's chain. Association placement and sheet close take the same
transaction-scoped advisory lock before checking for closed history. A later
open association or second close in either chain fails at the database layer;
no owner names or global policy-only uniqueness are used. Run the invariant
tests with:

```sh
npm run test:db:pay-sheet-single-settlement
```

Chargebacks, manual corrections, direct deposits, check income, and ACH income
live in the discriminated `pay_sheet_adjustments` table. Only audited admin
functions can create/update/delete rows, and the item-27 parent lock restricts
all writes to open sheets. Corrections carry negative deltas; direct income is
positive and Sophia-only. Closing folds those rows into frozen totals without
creating policy snapshots or changing KPI policy actuals. Run:

```sh
npm run test:db:pay-sheet-adjustments
```

Admin pay-sheet reads use `GET /api/pay-sheets` and
`GET /api/pay-sheets/:paySheetId`. Both routes are explicitly admin-guarded and
project their summary/detail contracts before serialization. Open sheets derive
current policy, effective-rate, adjustment, and total views with exact cent
math. Closed sheets read their policy, rate, and total values only from frozen
history; live policy or rate changes cannot change a closed response. Sophia
agency gross, Sophia share, and Sophia take-home remain separate fields.

Run the route and disposable-database read contracts with:

```sh
node --import tsx --test server/http/pay-sheets.test.ts
npm run test:db:pay-sheet-read
```

`POST /api/pay-sheets/:paySheetId/close` accepts an empty body and delegates the
entire close to the atomic `closePaySheet` boundary. The actor, timestamp,
totals, snapshots, rate, owner, and next period are server-derived. Its result,
closed detail, and next-sheet summary all pass through admin-only field
projection. Repeated and concurrent requests reuse the one established next
period; no reopen endpoint exists.

Open-sheet adjustments use `POST /api/pay-sheets/:paySheetId/adjustments` plus
`PUT`/`DELETE /api/pay-sheet-adjustments/:adjustmentId`. All three routes are
admin-only and call the existing audited database services. Update/delete
derive the sheet from the stored adjustment, so a client cannot move an
adjustment across sheets. Direct income is Sophia-only; producer sheets accept
payout reductions only. Closed-sheet writes conflict, while corrections belong
on the next open sheet. Mutation metadata and the refreshed sheet are both
field-projected before serialization.

## Structured logging

The backend writes newline-delimited JSON records with a timestamp, level,
message, and optional safe context. Request records contain only the route
template, method, status, and duration. Logs must not include request bodies,
headers, cookies, credentials, PII, stored financial values, or concrete route
parameters; the logger applies bounded defensive redaction if a caller passes
sensitive context by mistake.

Unexpected exceptions are represented locally by error type only. The logger
has a Sentry-shaped `captureException(error, { level, tags, extra })` adapter
boundary so later integration will not require route-handler changes. Foundation
uses a no-op adapter: there is no Sentry SDK, DSN, initialization, release
metadata, event shipping, or other telemetry dependency in this milestone.

## Module rules

- Routes parse transport input and delegate; domain services own business
  rules; repositories own SQL and persistence details.
- Authentication identifies the account. Authorization independently checks
  role, capability, record scope, and field visibility.
- Endpoint responses use explicit role-aware projections. Never return a full
  database row and rely on the browser to hide financial fields.
- Tests assert observable contracts and permission invariants, not private
  implementation details.
- New dependencies require a concrete use case and should be added by the
  ticket that first needs them.
