import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationDatabaseUrl } from "./migration-config.js";

test("migration config prefers dedicated credentials", () => {
  const migrationUrl =
    "postgresql://migrator:secret@managed.example:25060/wcib";

  assert.equal(
    readMigrationDatabaseUrl({
      DATABASE_MIGRATE_URL: migrationUrl,
      DATABASE_URL: "postgresql://runtime:secret@runtime.example:25060/wcib",
    }),
    migrationUrl,
  );
});

test("migration config falls back to the local runtime URL", () => {
  const localUrl = "postgresql://wcib:secret@db:5432/wcib";

  assert.equal(readMigrationDatabaseUrl({ DATABASE_URL: localUrl }), localUrl);
});

test("migration config fails clearly when credentials are missing", () => {
  assert.throws(
    () => readMigrationDatabaseUrl({}),
    /DATABASE_MIGRATE_URL or DATABASE_URL is required/,
  );
});
