# Database migrations

Drizzle-generated SQL migrations and metadata live in this directory. Commit
both the SQL file and its matching `meta` updates together.

Generate migrations from `server/db/schema.ts` with `npm run db:generate`,
validate the migration history with `npm run db:check`, and apply pending
migrations with `npm run db:migrate`.

Do not place prototype data imports, production credentials, or manual data
backfills here. A migration that changes financial or authorization behavior
must be reviewed with its owning ticket.

Reviewed reverse SQL lives in `backout/` and is never applied by the normal
migration runner. Backout files are for unused or disposable environments;
after financial data exists, preserve the data and use a reviewed forward fix.

`0000_baseline.sql` intentionally executes only `SELECT 1`. It proves the
migration pipeline and creates Drizzle's migration-history record without
creating WCIB tables or data.
