import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0027_mga_pay_sheet_attachment.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0027_mga_pay_sheet_attachment.sql"),
  "utf8",
);

test("attachment migration follows and directly binds both pay-sheet relations", () => {
  const migrationNames = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^002[5-7]_.*\.sql$/.test(name),
  );
  assert.deepEqual(migrationNames, [
    "0025_pay_sheets.sql",
    "0026_pay_sheet_policies.sql",
    "0027_mga_pay_sheet_attachment.sql",
  ]);
  assert.match(migrationSql, /ON "pay_sheets"/);
  assert.match(
    migrationSql,
    /CREATE TRIGGER "pay_sheet_policy_placement_path_trigger"[\s\S]*ON "pay_sheet_policies"/,
  );
  assert.match(
    migrationSql,
    /CREATE FUNCTION "sync_mga_payment_sheet_placement"[\s\S]*SECURITY DEFINER/,
  );
  assert.match(migrationSql, /FROM "policies"[\s\S]*FOR UPDATE/);
  assert.match(migrationSql, /FROM "mga_payments"[\s\S]*FOR UPDATE/);
  assert.match(migrationSql, /ON CONFLICT \("pay_sheet_id", "policy_id"\) DO NOTHING/);
  assert.match(migrationSql, /open_sheet\."status" = 'open'/);
  assert.match(migrationSql, /closed_sheet\."status" = 'closed'/);
  assert.match(migrationSql, /mga_payment_sheet_attached/);
  assert.match(migrationSql, /mga_payment_sheet_detached/);
  assert.match(migrationSql, /PERFORM "record_audit_event"/);
  assert.match(migrationSql, /pay_sheets_single_open_sophia_idx/);
  assert.match(migrationSql, /pay_sheets_single_open_producer_idx/);
  assert.doesNotMatch(
    migrationSql,
    /to_regclass|information_schema|EXECUTE format|CREATE TABLE|UPDATE "policies"|UPDATE "mga_payments"|set_mga_payment_state/i,
  );
});

test("attachment backout removes rules without touching association history", () => {
  assert.match(
    backoutSql,
    /DROP FUNCTION IF EXISTS "sync_mga_payment_sheet_placement"/,
  );
  assert.match(backoutSql, /DROP INDEX IF EXISTS/);
  assert.match(backoutSql, /forward-fix/i);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE|DELETE FROM|UPDATE |TRUNCATE|DROP TYPE/i,
  );
});
