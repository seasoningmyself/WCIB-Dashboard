import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0044_policy_soft_delete.sql"),
  "utf8",
);
const backout = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0044_policy_soft_delete.sql"),
  "utf8",
);
const guardMigration = readFileSync(
  resolve(
    process.cwd(),
    "drizzle/0045_policy_soft_delete_guard_hardening.sql",
  ),
  "utf8",
);
const guardBackout = readFileSync(
  resolve(
    process.cwd(),
    "drizzle/backout/0045_policy_soft_delete_guard_hardening.sql",
  ),
  "utf8",
);

test("policy soft-delete migration owns recoverable state and audited transitions", () => {
  for (const column of ["deleted_at", "deleted_by_user_id", "delete_reason"]) {
    assert.match(migration, new RegExp(`ADD COLUMN "${column}"`));
  }
  assert.match(migration, /policies_deletion_state_check/);
  assert.match(migration, /policy_soft_deleted/);
  assert.match(migration, /policy_restored/);
  assert.match(migration, /CREATE FUNCTION "soft_delete_policy"/);
  assert.match(migration, /CREATE FUNCTION "restore_policy"/);
  assert.match(migration, /record_audit_event/);
  assert.match(migration, /deleted_policy_sheet_attachment_forbidden/);
  assert.match(migration, /deleted_policy_change_request_forbidden/);
});

test("policy deletion serializes with existing close and MGA placement functions", () => {
  assert.match(migration, /pg_advisory_xact_lock\(20260714, 44\)/);
  for (const functionName of [
    "close_pay_sheet",
    "close_pay_sheet_with_cascade",
    "set_mga_payment_state",
    "sync_mga_payment_sheet_placement",
    "sync_mga_payment_sheet_placement_without_lazy_init",
  ]) {
    assert.match(
      migration,
      new RegExp(`ALTER FUNCTION "${functionName}"[\\s\\S]*RENAME TO`),
    );
  }
  assert.doesNotMatch(migration, /UPDATE "pay_sheet_policies"[\s\S]*frozen_/);
  assert.doesNotMatch(migration, /UPDATE "pay_sheets"[\s\S]*frozen_/);
});

test("policy deletion backout is data-safe and restores wrapped functions", () => {
  assert.match(backout, /policy deletion history is in use; preserve it and forward-fix/);
  assert.match(backout, /DROP FUNCTION "restore_policy"/);
  assert.match(backout, /DROP FUNCTION "soft_delete_policy"/);
  assert.match(backout, /RENAME TO "close_pay_sheet"/);
  assert.match(backout, /RENAME TO "sync_mga_payment_sheet_placement"/);
  assert.match(backout, /DROP COLUMN "delete_reason"/);
  assert.match(backout, /DROP COLUMN "deleted_by_user_id"/);
  assert.match(backout, /DROP COLUMN "deleted_at"/);
  assert.doesNotMatch(backout, /DELETE FROM|TRUNCATE/);
});

test("policy deletion context checks execute as the invoking role", () => {
  assert.match(
    guardMigration,
    /ALTER FUNCTION "enforce_policy_soft_delete_state"\(\) SECURITY INVOKER/,
  );
  assert.match(
    guardBackout,
    /policy deletion guard is in use; preserve it and forward-fix/,
  );
  assert.match(
    guardBackout,
    /ALTER FUNCTION "enforce_policy_soft_delete_state"\(\) SECURITY DEFINER/,
  );
});
