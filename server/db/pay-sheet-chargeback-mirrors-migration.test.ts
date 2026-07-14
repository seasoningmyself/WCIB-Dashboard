import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0041_pay_sheet_chargeback_mirrors.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0041_pay_sheet_chargeback_mirrors.sql"),
  "utf8",
);

test("one migration owns atomic producer chargeback mirrors", () => {
  assert.match(migrationSql, /ADD COLUMN "source_adjustment_id" uuid/);
  assert.match(migrationSql, /FOREIGN KEY \("source_adjustment_id"\)/);
  assert.match(migrationSql, /CREATE UNIQUE INDEX "pay_sheet_adjustments_source_adjustment_idx"/);
  for (const functionName of [
    "create_pay_sheet_adjustment_with_mirror",
    "update_pay_sheet_adjustment_with_mirror",
    "delete_pay_sheet_adjustment_with_mirror",
    "sync_pay_sheet_chargeback_mirror",
  ]) {
    assert.match(migrationSql, new RegExp(`CREATE FUNCTION "${functionName}"`));
    assert.match(migrationSql, new RegExp(`REVOKE ALL ON FUNCTION "${functionName}"`));
  }
  assert.match(migrationSql, /-abs\(p_broker_fee_delta\)/);
  assert.match(migrationSql, /-abs\(p_commission_delta\)/);
  assert.match(migrationSql, /"renewal_commission_rate"/);
  assert.match(migrationSql, /"renewal_broker_rate"/);
  assert.match(migrationSql, /"initialize_pay_sheet_owner_chain"/);
  assert.match(migrationSql, /"create_pay_sheet_adjustment"/);
  assert.match(migrationSql, /"update_pay_sheet_adjustment"/);
  assert.match(migrationSql, /"delete_pay_sheet_adjustment"/);
  assert.match(migrationSql, /pay_sheet_adjustment_mirror_function_only/);
});

test("mirror backout refuses linkage loss and restores the prior guard", () => {
  assert.match(backoutSql, /WHERE "source_adjustment_id" IS NOT NULL/);
  assert.match(backoutSql, /cannot back out chargeback mirrors/i);
  assert.match(backoutSql, /CREATE OR REPLACE FUNCTION "enforce_pay_sheet_adjustment_write_path"/);
  assert.match(backoutSql, /DROP COLUMN IF EXISTS "source_adjustment_id"/);
  assert.doesNotMatch(backoutSql, /DELETE FROM|TRUNCATE|DROP TABLE/i);
});
