import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0013_draft_integrity.sql"),
  "utf8",
);

test("draft integrity owns one trigger-backed transition contract", () => {
  assert.match(migrationSql, /CREATE FUNCTION "transition_draft_status"/);
  assert.match(migrationSql, /CREATE FUNCTION "enforce_draft_integrity"/);
  assert.match(migrationSql, /CREATE TRIGGER "draft_integrity_trigger"/);
  assert.match(migrationSql, /CONSTRAINT = 'draft_owner_immutable'/);
  assert.match(migrationSql, /CONSTRAINT = 'draft_status_stale'/);
  assert.match(migrationSql, /CONSTRAINT = 'draft_approved_terminal'/);
  assert.match(migrationSql, /REVOKE ALL ON FUNCTION "transition_draft_status"/);
  assert.doesNotMatch(migrationSql, /CREATE TABLE|ALTER TABLE|DROP TABLE/i);
});

test("draft integrity backout preserves draft rows and schema", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0013_draft_integrity.sql"),
    "utf8",
  );

  assert.match(backoutSql, /DROP TRIGGER IF EXISTS "draft_integrity_trigger"/);
  assert.match(backoutSql, /DROP FUNCTION IF EXISTS "enforce_draft_integrity"/);
  assert.match(backoutSql, /DROP FUNCTION IF EXISTS "transition_draft_status"/);
  assert.doesNotMatch(backoutSql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});
