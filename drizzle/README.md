# Database migrations

Drizzle-generated SQL migrations and metadata live in this directory. Commit
both the SQL file and its matching `meta` updates together.

Generate migrations from `server/db/schema.ts` with `npm run db:generate`,
validate the migration history with `npm run db:check`, and apply pending
migrations with `npm run db:migrate`.

Do not place prototype data imports, production credentials, or manual data
backfills here. A migration that changes financial or authorization behavior
must be reviewed with its owning ticket.
