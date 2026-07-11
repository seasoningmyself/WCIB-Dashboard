import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0024_mga_payment_rules.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0024_mga_payment_rules.sql"),
  "utf8",
);

test("one dependency-safe migration owns audited MGA payment transitions", () => {
  const migrations = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^0024_.*\.sql$/.test(name),
  );

  assert.deepEqual(migrations, ["0024_mga_payment_rules.sql"]);
  assert.match(migrationSql, /policies_mga_paid_state_check/);
  assert.match(
    migrationSql,
    /CREATE FUNCTION "set_mga_payment_state"[\s\S]*SECURITY DEFINER/,
  );
  assert.match(migrationSql, /PERFORM "require_lifecycle_admin"/);
  assert.match(migrationSql, /FROM "policies"[\s\S]*FOR UPDATE/);
  assert.match(migrationSql, /FROM "mga_payments"[\s\S]*FOR UPDATE/);
  assert.match(migrationSql, /PERFORM "record_audit_event"/);
  assert.match(migrationSql, /mga_payment_marked_paid/);
  assert.match(migrationSql, /mga_payment_marked_unpaid/);
  assert.match(migrationSql, /mga_payment_write_path_trigger/);
  assert.match(migrationSql, /policy_mga_payment_write_path_trigger/);
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION "set_mga_payment_state"/,
  );
  assert.doesNotMatch(
    migrationSql,
    /pay_sheet|to_regclass|information_schema|EXECUTE format|CREATE TABLE/i,
  );
});

test("MGA payment rule backout preserves financial and audit rows", () => {
  assert.match(backoutSql, /DROP FUNCTION IF EXISTS "set_mga_payment_state"/);
  assert.match(backoutSql, /policies_mga_paid_state_check/);
  assert.match(backoutSql, /forward-fix/i);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE|DELETE FROM|TRUNCATE|DROP TYPE|pay_sheet/i,
  );
});
