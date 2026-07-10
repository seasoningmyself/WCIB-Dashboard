import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatMigrationSafetyError,
  verifyMigrationSafety,
} from "./migration-safety.js";

test("migration safety verification refuses managed and production hosts", async () => {
  await assert.rejects(
    verifyMigrationSafety(
      "postgresql://wcib_migrator:secret@private-example.db.ondigitalocean.com:25060/wcib",
    ),
    /only accepts the local Docker PostgreSQL source/,
  );
});

test("migration safety errors expose only a sanitized database code", () => {
  const error = Object.assign(
    new Error("failed for postgresql://user:secret@example.test/wcib"),
    { code: "55000" },
  );

  assert.equal(
    formatMigrationSafetyError(error),
    "Migration safety verification failed (55000)",
  );
});
