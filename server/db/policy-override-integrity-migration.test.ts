import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0022_policy_override_integrity.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0022_policy_override_integrity.sql"),
  "utf8",
);

test("one migration owns audited policy override integrity", () => {
  const migrations = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^0022_.*\.sql$/.test(name),
  );

  assert.deepEqual(migrations, ["0022_policy_override_integrity.sql"]);
  assert.match(migrationSql, /ADD COLUMN "overridden" boolean/);
  assert.match(migrationSql, /policy_overrides_reason_check/);
  assert.match(
    migrationSql,
    /CREATE FUNCTION "apply_policy_override"[\s\S]*SECURITY DEFINER/,
  );
  assert.match(migrationSql, /PERFORM "require_lifecycle_admin"/);
  assert.match(migrationSql, /FOR UPDATE/);
  assert.match(migrationSql, /PERFORM "record_audit_event"/);
  assert.match(migrationSql, /policy_overrides_append_only_trigger/);
  assert.match(migrationSql, /policy_overrides_insert_path_trigger/);
  assert.match(migrationSql, /policy_override_write_path_trigger/);
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION "apply_policy_override"/,
  );
  assert.match(migrationSql, /REVOKE UPDATE, DELETE ON "policy_overrides"/);
  assert.doesNotMatch(
    migrationSql,
    /CREATE TABLE|CREATE TYPE|carrier_fee|budget|pay_sheet|mga_payment/i,
  );
});

test("override backout removes only item-20 enforcement in unused databases", () => {
  assert.match(backoutSql, /DROP FUNCTION IF EXISTS "apply_policy_override"/);
  assert.match(backoutSql, /DROP COLUMN "overridden"/);
  assert.match(backoutSql, /forward-fix/i);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE|DELETE FROM|TRUNCATE|DROP TYPE|DROP COLUMN "original_values"/i,
  );
});
