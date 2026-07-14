import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0046_approval_work_soft_delete.sql"),
  "utf8",
);
const backout = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0046_approval_work_soft_delete.sql"),
  "utf8",
);

test("approval-work deletion migration owns recoverable state and trusted transitions", () => {
  for (const table of ["approval_queue_entries", "drafts"]) {
    for (const column of ["deleted_at", "deleted_by_user_id", "delete_reason"]) {
      assert.match(
        migration,
        new RegExp(`ALTER TABLE "${table}" ADD COLUMN "${column}"`),
      );
    }
  }
  assert.match(migration, /approval_work_soft_deleted/);
  assert.match(migration, /approval_work_restored/);
  assert.match(migration, /CREATE FUNCTION "soft_delete_approval_work"/);
  assert.match(migration, /CREATE FUNCTION "restore_approval_work"/);
  assert.match(migration, /CREATE FUNCTION "enforce_approval_work_soft_delete_state"/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "enforce_draft_integrity"/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION "enforce_approval_queue_integrity"/,
  );
  assert.match(
    migration,
    /deletion_context NOT IN \('delete', 'restore'\)/,
  );
  for (const column of ["deleted_at", "deleted_by_user_id", "delete_reason"]) {
    assert.match(migration, new RegExp(`'${column}'`));
  }
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /require_lifecycle_admin/);
  assert.match(migration, /record_audit_event/);
  assert.doesNotMatch(migration, /ALTER TYPE [^;]+ ADD VALUE/);
});

test("approval-work deletion locks queue before draft and rejects ledger-linked work", () => {
  assert.match(
    migration,
    /FROM "approval_queue_entries"[\s\S]+FOR UPDATE;[\s\S]+FROM "drafts"[\s\S]+FOR UPDATE;/,
  );
  assert.match(migration, /only pending or flagged approval work may be deleted/);
  assert.match(migration, /approved or pay-sheet-linked work cannot be deleted/);
  assert.match(migration, /FROM "pay_sheet_policies"/);
  assert.match(migration, /deleted approval work is immutable until restored/);
});

test("approval-work deletion backout is data-safe and removes only M2 state", () => {
  assert.match(
    backout,
    /approval-work deletion history is in use; preserve it and forward-fix/,
  );
  assert.match(backout, /DROP FUNCTION "restore_approval_work"/);
  assert.match(backout, /DROP FUNCTION "soft_delete_approval_work"/);
  assert.match(
    backout,
    /CREATE OR REPLACE FUNCTION "enforce_draft_integrity"/,
  );
  assert.match(
    backout,
    /CREATE OR REPLACE FUNCTION "enforce_approval_queue_integrity"/,
  );
  assert.match(backout, /DROP COLUMN "delete_reason"/);
  assert.match(backout, /DROP COLUMN "deleted_by_user_id"/);
  assert.match(backout, /DROP COLUMN "deleted_at"/);
  assert.doesNotMatch(backout, /DELETE FROM|TRUNCATE/);
});
