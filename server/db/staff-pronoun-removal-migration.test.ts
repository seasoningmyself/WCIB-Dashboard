import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0051_remove_staff_pronoun.sql"),
  "utf8",
);
const backout = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0051_remove_staff_pronoun.sql"),
  "utf8",
);

test("pronoun removal drops the dependent column before its enum", () => {
  const dropColumn = migration.indexOf(
    'ALTER TABLE "staff_profiles" DROP COLUMN "pronoun"',
  );
  const dropEnum = migration.indexOf('DROP TYPE "public"."staff_pronoun"');
  assert.ok(dropColumn >= 0);
  assert.ok(dropEnum > dropColumn);
  assert.match(migration, /"expected_migration_count" = 52/);
  assert.match(
    migration,
    /0185cf8f1e925f2255f565e7b4e71e99e9db7eae3551518241af40f56cbc7553/,
  );
});

test("pronoun removal backout recreates the original enum and generation contract", () => {
  assert.match(
    backout,
    /CREATE TYPE "public"\."staff_pronoun" AS ENUM\('her', 'his', 'their'\)/,
  );
  assert.match(
    backout,
    /ADD COLUMN "pronoun" "staff_pronoun" DEFAULT 'their' NOT NULL/,
  );
  assert.match(backout, /"expected_migration_count" = 51/);
  assert.match(
    backout,
    /38587c7e033c1435be24e7914b0a167d29ee56c2176a20c79b3cd140671e64c1/,
  );
});
