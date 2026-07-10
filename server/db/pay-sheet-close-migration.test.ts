import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0028_pay_sheet_close.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0028_pay_sheet_close.sql"),
  "utf8",
);

test("pay-sheet close migration owns one dependency-safe atomic function", () => {
  const migrationNames = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^002[5-8]_.*\.sql$/.test(name),
  );
  assert.deepEqual(migrationNames, [
    "0025_pay_sheets.sql",
    "0026_pay_sheet_policies.sql",
    "0027_mga_pay_sheet_attachment.sql",
    "0028_pay_sheet_close.sql",
  ]);
  assert.match(
    migrationSql,
    /CREATE FUNCTION "close_pay_sheet"\(\s*"p_pay_sheet_id" uuid,\s*"p_actor_user_id" uuid\s*\)/,
  );
  assert.match(migrationSql, /SECURITY DEFINER/);
  assert.match(migrationSql, /PERFORM "require_lifecycle_admin"/);
  assert.match(migrationSql, /FROM "pay_sheets"[\s\S]*FOR UPDATE/);
  assert.match(migrationSql, /FOR UPDATE OF psp/);
  assert.match(migrationSql, /FOR UPDATE OF p/);
  assert.match(migrationSql, /FOR SHARE OF pt/);
  assert.match(migrationSql, /FROM "producer_rate_history"[\s\S]*FOR UPDATE/);
  assert.match(migrationSql, /"effective_date" <= \(closed_at_value AT TIME ZONE 'UTC'\)::date/);
  assert.match(migrationSql, /PERFORM "lock_producer_rate_history_for_close"/);
  assert.match(migrationSql, /"frozen_policy_snapshot"/);
  assert.match(migrationSql, /"frozen_policy_snapshot" = snapshot_values\.policy_snapshot/);
  assert.match(migrationSql, /"frozen_rate_snapshot" = snapshot_values\.rate_snapshot/);
  assert.match(migrationSql, /'sophiaAgencyGross'/);
  assert.match(migrationSql, /'sophiaTakeHome'/);
  assert.match(migrationSql, /'producerPayout'/);
  assert.match(migrationSql, /'pay_sheet_closed'/);
  assert.match(migrationSql, /target_sheet\."period_month" = 12/);
  assert.match(migrationSql, /next_period_month := 1/);
  assert.match(migrationSql, /next_period_year := target_sheet\."period_year" \+ 1/);
  assert.doesNotMatch(
    migrationSql,
    /carrierFee|carrier_fee|rewriteSubtype|rewrite_subtype|reopen/i,
  );
});

test("pay-sheet close backout cannot edit financial history", () => {
  assert.match(
    backoutSql,
    /DROP FUNCTION IF EXISTS "close_pay_sheet"\(uuid, uuid\)/,
  );
  assert.match(backoutSql, /forward-fix/i);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE|DELETE FROM|UPDATE |TRUNCATE|ALTER TABLE|DROP TYPE/i,
  );
});
