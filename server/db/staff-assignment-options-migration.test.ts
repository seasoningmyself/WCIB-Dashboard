import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  approvedCoreMigrationCount,
  approvedCoreSchemaFingerprint,
} from "./core-schema-contract.js";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0055_staff_assignment_options.sql"),
  "utf8",
);
const backout = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0055_staff_assignment_options.sql"),
  "utf8",
);

test("staff assignment migration adds both options and advances generation contract", () => {
  assert.match(
    migration,
    /ADD COLUMN "book_assignment_enabled" boolean DEFAULT true NOT NULL/,
  );
  assert.match(
    migration,
    /ADD COLUMN "first_year_assignment_enabled" boolean DEFAULT true NOT NULL/,
  );
  assert.match(migration, /"expected_migration_count" = 56/);
  assert.equal(approvedCoreMigrationCount, 56);
  assert.equal(
    approvedCoreSchemaFingerprint,
    "47c912b2cfdc868974d514f5ff04f8a9971d00053fc6a2b5c091dc258d3569dc",
  );
  assert.match(migration, new RegExp(approvedCoreSchemaFingerprint));
});

test("staff assignment backout fails closed after configuration is used", () => {
  assert.match(backout, /staff_assignment_configuration_in_use/);
  assert.match(backout, /"book_assignment_enabled" IS NOT TRUE/);
  assert.match(backout, /"first_year_assignment_enabled" IS NOT TRUE/);
  assert.match(backout, /"expected_migration_count" = 55/);
  assert.match(
    backout,
    /3af121916d459cb042c746c1b4e2cacd0eeb311be7b7b7f4d94170e7f16cedcf/,
  );
  assert.doesNotMatch(backout, /DELETE FROM|TRUNCATE/i);
});
