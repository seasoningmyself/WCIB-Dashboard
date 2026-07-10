import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMigrationError } from "./migrate.js";

test("formatMigrationError keeps missing-config guidance", () => {
  assert.equal(
    formatMigrationError(
      new Error("DATABASE_MIGRATE_URL or DATABASE_URL is required"),
    ),
    "DATABASE_MIGRATE_URL or DATABASE_URL is required",
  );
});

test("formatMigrationError reports a code without leaking error details", () => {
  const error = Object.assign(
    new Error("could not connect using postgresql://wcib:secret@example/wcib"),
    { code: "ECONNREFUSED" },
  );

  assert.equal(
    formatMigrationError(error),
    "Database migration failed (ECONNREFUSED)",
  );
});

test("formatMigrationError finds a nested connection code", () => {
  const error = new AggregateError([
    Object.assign(new Error("secret connection details"), { code: "EPERM" }),
  ]);

  assert.equal(formatMigrationError(error), "Database migration failed (EPERM)");
});

test("formatMigrationError finds a wrapped driver error code", () => {
  const error = Object.assign(new Error("query failed"), {
    cause: Object.assign(new Error("secret connection details"), {
      code: "ECONNREFUSED",
    }),
  });

  assert.equal(
    formatMigrationError(error),
    "Database migration failed (ECONNREFUSED)",
  );
});
