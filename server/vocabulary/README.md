# Vocabulary contracts

This directory holds server-side decision logic shared by future vocabulary
routes and services. It does not register routes or perform database writes.

`mgas.ts` is the entry point for the admin-only MGA-add decision and reproduces
the active v15 similarity advisory at its actual 75% threshold. Exact database
uniqueness remains in migration `0009_mgas`; in-use deletion protection belongs
to the later policy foreign-key migration.

`add-rules.ts` exports the explicit route requirement and vocabulary-only insert
decisions for carriers and policy types. Callers must pass all existing names,
including inactive rows, so a deactivated name cannot be silently reused.

Run the contract tests with `npm test`.
