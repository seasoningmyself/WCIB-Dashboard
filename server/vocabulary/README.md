# Vocabulary contracts

This directory holds the controlled-vocabulary read boundary and server-side
decision logic shared by vocabulary routes and services.

`active.ts` loads bounded, active-only carrier, policy-type, MGA, and office
options in deterministic display order. `GET /api/vocabulary` is registered
through the mandatory route registrar, permits admin/producer/employee
principals, and projects exact picker fields through `projectAuthorizedFields`.
It returns valid empty arrays when WCIB has no vocabulary data.

`create.ts` owns the audited carrier and policy-type write service. The two
POST routes permit admin/producer/employee principals, normalize bounded names,
return picker-safe HTTP 409 duplicates, and commit each new row with its
append-only creation event in one database transaction. Audit actor identity
comes only from the trusted authorization context.

`mgas.ts` is the entry point for the admin-only MGA-add decision and reproduces
the active v15 similarity advisory at its actual 75% threshold. Exact database
uniqueness remains in migration `0009_mgas`; in-use deletion protection belongs
to the later policy foreign-key migration.

`add-rules.ts` exports the explicit route requirement and vocabulary-only insert
decisions for carriers and policy types. Callers must pass all existing names,
including inactive rows, so a deactivated name cannot be silently reused.

Run contract tests with `npm test`. Run the database-backed active read check
with `npm run test:db:vocabulary-read` against a migrated database.
