import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationPath = resolve(
  process.cwd(),
  "drizzle/0020_policy_lifecycle.sql",
);
const backoutPath = resolve(
  process.cwd(),
  "drizzle/backout/0020_policy_lifecycle.sql",
);

test("policy lifecycle owns one dependency-safe integrity migration", () => {
  const migrationSql = readFileSync(migrationPath, "utf8");
  const lifecycleMigrations = readdirSync(resolve(process.cwd(), "drizzle"))
    .filter((name) => /^0020_.*\.sql$/.test(name));

  assert.deepEqual(lifecycleMigrations, ["0020_policy_lifecycle.sql"]);
  assert.doesNotMatch(migrationSql, /ALTER TYPE[\s\S]*ADD VALUE/i);
  assert.match(migrationSql, /approval_queue_status_lifecycle/);
  assert.match(
    migrationSql,
    /DROP INDEX "approval_queue_entries_active_draft_idx"[\s\S]*CREATE UNIQUE INDEX "approval_queue_entries_active_draft_idx"/,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX "policies_source_draft_unique_idx"/,
  );
  assert.match(migrationSql, /CREATE FUNCTION "submit_draft_for_approval"/);
  assert.match(migrationSql, /CREATE FUNCTION "flag_draft_for_help"/);
  assert.match(migrationSql, /CREATE FUNCTION "send_back_queued_draft"/);
  assert.match(
    migrationSql,
    /CREATE FUNCTION "resolve_queued_policy_approval"/,
  );
  assert.match(migrationSql, /CREATE FUNCTION "resolve_admin_direct_policy"/);
  assert.match(
    migrationSql,
    /CREATE TRIGGER "policy_lifecycle_identity_trigger"/,
  );
  assert.equal(
    [...migrationSql.matchAll(/DEFERRABLE INITIALLY DEFERRED/g)].length,
    3,
  );
  assert.equal(
    [...migrationSql.matchAll(/PERFORM "record_audit_event"/g)].length,
    5,
  );
  assert.match(migrationSql, /PERFORM "require_lifecycle_admin"/);
  assert.match(migrationSql, /PERFORM "require_lifecycle_staff"/);
  assert.doesNotMatch(
    migrationSql,
    /CREATE TABLE|pay_sheets|pay_sheet_policies|carrier_fee|budget/i,
  );
});

test("policy lifecycle backout preserves business and audit rows", () => {
  const backoutSql = readFileSync(backoutPath, "utf8");

  assert.match(backoutSql, /DROP TRIGGER IF EXISTS/);
  assert.match(backoutSql, /DROP FUNCTION IF EXISTS/);
  assert.match(
    backoutSql,
    /CREATE OR REPLACE FUNCTION "enforce_draft_integrity"/,
  );
  assert.match(
    backoutSql,
    /CREATE INDEX IF NOT EXISTS "policies_source_draft_idx"/,
  );
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE|DELETE FROM|TRUNCATE|DROP TYPE/i,
  );
});
