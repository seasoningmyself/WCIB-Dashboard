import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0023_mga_payments.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0023_mga_payments.sql"),
  "utf8",
);

test("one migration owns the current MGA payment-state table", () => {
  const migrations = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^0023_.*\.sql$/.test(name),
  );

  assert.deepEqual(migrations, ["0023_mga_payments.sql"]);
  assert.match(
    migrationSql,
    /CREATE TYPE "public"\."mga_payment_status" AS ENUM\('unpaid', 'paid'\)/,
  );
  assert.match(migrationSql, /CREATE TABLE "mga_payments"/);
  for (const column of [
    "id",
    "policy_id",
    "status",
    "reference",
    "paid_at",
    "admin_actor_user_id",
    "created_at",
    "updated_at",
  ]) {
    assert.match(migrationSql, new RegExp(`"${column}"`));
  }
  assert.match(migrationSql, /mga_payments_policy_unique_idx/);
  assert.equal(
    [...migrationSql.matchAll(/REFERENCES "public"\."(?:policies|users)"/g)]
      .length,
    2,
  );
  assert.equal([...migrationSql.matchAll(/ON DELETE restrict/g)].length, 2);
  assert.match(migrationSql, /mga_payments_state_check/);
  assert.match(migrationSql, /mga_payments_timestamp_order_check/);
  assert.doesNotMatch(
    migrationSql,
    /CREATE FUNCTION|CREATE TRIGGER|pay_sheet|remittance|carrier_fee|budget/i,
  );
});

test("MGA payment backout is explicit about its unused-only boundary", () => {
  assert.match(backoutSql, /DROP TABLE IF EXISTS "mga_payments"/);
  assert.match(backoutSql, /DROP TYPE IF EXISTS "mga_payment_status"/);
  assert.match(backoutSql, /forward-fix/i);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE.*(?:policies|users|audit_events)|DELETE FROM|TRUNCATE/i,
  );
});
