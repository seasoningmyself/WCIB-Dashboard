# Managed Core Schema deployment record

## Target

- DigitalOcean cluster: `igotabigdb`
- Region/VPC: SFO3 / `default-sfo3`
- Database: `wcib`
- PostgreSQL: `18.4`
- Migration role: `wcib_migrator` over TLS `verify-full`
- Runtime smoke role: `wcib_runtime` over TLS `verify-full`

No connection string, password, certificate content, PII, client record, or
financial value is recorded here.

## Preflight and checkpoint

- STONE-73 rollback proof commit: `8a63c1e`
- Pre-migration checkpoint time: `2026-07-10T19:56:17Z`
- DigitalOcean recovery UI verified before apply: Latest Backup available and
  point-in-time restore available for the prior seven days.
- Managed preflight at `2026-07-10T19:58:08Z`: role `wcib_migrator`, database
  `wcib`, PostgreSQL `18.4`, zero public tables, and no migration history table.
- Production app containers running during apply: zero.
- Local PostgreSQL 18 forward/rollback/reapply and failure injection: passed.

## Apply

- Applied at: `2026-07-10T19:58Z`
- Command: `DOTENV_CONFIG_PATH=.env.managed.local npm run db:migrate`
- Ordered range: `0000_baseline` through `0032_kpi_targets`
- Result: success, one migration process, 18.05 seconds.
- Prototype/localStorage import: none.
- Vocabulary seed: none.
- Application deployment: none.

## Verification

`DOTENV_CONFIG_PATH=.env.managed.local npm run db:verify:managed` completed at
`2026-07-10T20:02:39Z` with:

- 33 current migration history rows.
- 22 approved application tables.
- 0 application rows across all 22 tables.
- 38 foreign keys.
- 84 check constraints.
- 20 non-internal triggers.
- 37 public functions.
- 68 public indexes.
- 0 forbidden tables and columns, including all budget tables,
  `migration_batches`, `export_jobs`, `carrier_mga_defaults`, `carrier_fee`,
  `balance_due_from_insured`, and `remaining_net_due`.
- Approved schema fingerprint:
  `4fe5a824266f66632f1fb7e92ad57c9f2877d469895c49a336c9e06c4e8e4c91`.

The same fingerprint was produced by a fresh disposable local PostgreSQL 18
database built from the committed chain. The `wcib_runtime` `npm run db:smoke`
connection also passed after apply.

## Recovery boundary

The database remains blank at this checkpoint. If a schema defect is found
before any real row is entered, use the reviewed reverse order in
`MIGRATION_SAFETY.md`. Once identity, business, audit, rate, settlement, or
pay-sheet rows exist, preserve them and use a new forward-fix migration. Use a
DigitalOcean point-in-time restore to a new cluster if data correctness cannot
be preserved in place.

The next gate is STONE-75. Do not deploy the application or begin Milestone 3
until that gate is completed and the Core Schema parent is closed.
