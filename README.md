# WCIB Dashboard

WCIB Dashboard is the new multi-user application that will replace the
single-file prototype. The application starts from a blank database; prototype
`localStorage` data is not imported.

The authoritative behavior references are `wcib_dashboard_v15.html` and the
July 7 Engineer Handoff. Older data-model and permissions documents are useful
history but do not override those sources or the standing project decisions.

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

`SESSION_SECRET` must contain at least 32 characters. Production also rejects
the example development value. Startup errors identify a missing or invalid
variable but never print its value.

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
