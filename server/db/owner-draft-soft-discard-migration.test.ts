import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0050_owner_draft_soft_discard.sql"),
  "utf8",
);
const backout = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0050_owner_draft_soft_discard.sql"),
  "utf8",
);

test("owner draft discard is trusted, owner-scoped, generation-scoped, and audited", () => {
  assert.match(migration, /CREATE FUNCTION "soft_delete_own_draft"/);
  assert.match(migration, /CREATE FUNCTION "restore_discarded_draft"/);
  assert.match(migration, /SECURITY DEFINER/g);
  assert.match(migration, /current_business_state_generation_id/);
  assert.match(migration, /current_draft\."owner_user_id" <> p_actor_user_id/);
  assert.match(migration, /only an unsubmitted owner draft may be discarded/);
  assert.match(migration, /require_lifecycle_admin/);
  assert.match(migration, /approval_work_soft_deleted/);
  assert.match(migration, /approval_work_restored/);
  assert.match(migration, /'kind', 'draft'/);
  assert.match(migration, /"expected_migration_count" = 51/);
});

test("owner draft discard backout fails closed after use and restores Start Fresh count", () => {
  assert.match(
    backout,
    /owner draft discard history is in use; preserve it and forward-fix/,
  );
  assert.match(backout, /DROP FUNCTION "restore_discarded_draft"/);
  assert.match(backout, /DROP FUNCTION "soft_delete_own_draft"/);
  assert.match(backout, /"expected_migration_count" = 50/);
  assert.doesNotMatch(backout, /DELETE FROM|TRUNCATE/);
});
