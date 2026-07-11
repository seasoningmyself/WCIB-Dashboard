import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0031_pay_sheet_adjustments.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0031_pay_sheet_adjustments.sql"),
  "utf8",
);

test("one migration owns normalized audited pay-sheet adjustments", () => {
  const migrationNames = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^003[0-1]_.*\.sql$/.test(name),
  );
  assert.deepEqual(migrationNames, [
    "0030_pay_sheet_single_settlement.sql",
    "0031_pay_sheet_adjustments.sql",
  ]);
  assert.match(migrationSql, /CREATE TABLE "pay_sheet_adjustments"/);
  for (const field of [
    "id",
    "pay_sheet_id",
    "adjustment_type",
    "effective_date",
    "insured_or_client_label",
    "policy_type_id",
    "account_basis",
    "producer_user_id",
    "broker_fee_delta",
    "commission_delta",
    "payout_delta",
    "income_amount",
    "reason_or_note",
    "created_by_user_id",
    "created_at",
    "updated_at",
  ]) {
    assert.match(migrationSql, new RegExp(`"${field}"`));
  }
  for (const type of [
    "chargeback",
    "manual_adjustment",
    "direct_deposit",
    "check_income",
    "ach_income",
  ]) {
    assert.match(migrationSql, new RegExp(`'${type}'`));
  }
  assert.match(migrationSql, /pay_sheet_adjustments_value_shape_check/);
  assert.match(migrationSql, /require_open_pay_sheet_for_mutation/);
  assert.match(migrationSql, /pay_sheet_adjustment_function_only/);
  assert.match(migrationSql, /pay_sheet_adjustment_created/);
  assert.match(migrationSql, /pay_sheet_adjustment_updated/);
  assert.match(migrationSql, /pay_sheet_adjustment_deleted/);
  assert.match(migrationSql, /apply_pay_sheet_adjustments_to_close_totals/);
  assert.match(migrationSql, /FOR UPDATE OF adjustment/);
  assert.match(migrationSql, /'directCheckAchIncome'/);
  assert.match(migrationSql, /'producerPayout'/);
  assert.doesNotMatch(
    migrationSql,
    /UPDATE "policies"|INSERT INTO "policies"|pay_sheet_policies.*adjustment/i,
  );
});

test("adjustment backout refuses data loss and preserves predecessor objects", () => {
  assert.match(backoutSql, /IF EXISTS \(SELECT 1 FROM "pay_sheet_adjustments"\)/);
  assert.match(backoutSql, /forward-fix/i);
  assert.match(backoutSql, /DROP TABLE IF EXISTS "pay_sheet_adjustments"/);
  assert.doesNotMatch(
    backoutSql,
    /DELETE FROM|UPDATE |TRUNCATE|DROP TABLE IF EXISTS "pay_sheets"|DROP TABLE IF EXISTS "pay_sheet_policies"/i,
  );
});
