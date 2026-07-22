import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  approvedCoreMigrationCount,
  approvedCoreSchemaFingerprint,
} from "./core-schema-contract.js";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0054_support_engineer_capability.sql"),
  "utf8",
);
const backout = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0054_support_engineer_capability.sql"),
  "utf8",
);

test("support migration uses reversible audit enums and advances the generation contract", () => {
  assert.doesNotMatch(migration, /ALTER TYPE[\s\S]*ADD VALUE/i);
  assert.ok(
    migration.indexOf('DROP FUNCTION "record_audit_event"') <
      migration.indexOf('ALTER TYPE "audit_action" RENAME'),
  );
  assert.match(migration, /'support_surface_viewed'/);
  assert.match(migration, /'user_support_capability_changed'/);
  assert.match(migration, /'office_location_created'/);
  assert.match(migration, /'office_location'/);
  assert.match(migration, /ADD COLUMN "last_login_at"/);
  assert.match(migration, /"expected_migration_count" = 55/);
  assert.equal(approvedCoreMigrationCount, 55);
  assert.equal(
    approvedCoreSchemaFingerprint,
    "3af121916d459cb042c746c1b4e2cacd0eeb311be7b7b7f4d94170e7f16cedcf",
  );
  assert.match(
    migration,
    /3af121916d459cb042c746c1b4e2cacd0eeb311be7b7b7f4d94170e7f16cedcf/,
  );
});

test("support migration backout fails closed after support history", () => {
  assert.match(backout, /support_engineer_history_in_use/);
  assert.match(backout, /"capability" = 'support_engineer'/);
  assert.match(backout, /"last_login_at" IS NOT NULL/);
  assert.match(backout, /"expected_migration_count" = 54/);
  assert.match(
    backout,
    /a8a02c5d60d29136b7a0a28202ae97e05dfdf423d3c8e40440d18e3c60617ebf/,
  );
  assert.doesNotMatch(backout, /DELETE FROM "audit_events"|TRUNCATE/i);
});
