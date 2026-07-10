# Vocabulary contracts

This directory holds server-side decision logic shared by future vocabulary
routes and services. It does not register routes or perform database writes.

`mgas.ts` is the entry point for the admin-only MGA-add decision and reproduces
the active v15 similarity advisory at its actual 75% threshold. Exact database
uniqueness remains in migration `0009_mgas`; in-use deletion protection belongs
to the later policy foreign-key migration.

Run the contract tests with `npm test`.
