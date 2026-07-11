import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0018_audit_integrity.sql"),
  "utf8",
);

test("audit integrity migration owns the append-only write contract", () => {
  assert.match(migrationSql, /CREATE FUNCTION "record_audit_event"/);
  assert.match(migrationSql, /SECURITY DEFINER/);
  assert.match(migrationSql, /REVOKE ALL ON FUNCTION "record_audit_event"/);
  assert.match(
    migrationSql,
    /CREATE TRIGGER "audit_events_append_only_trigger"/,
  );
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON "audit_events"/);
  assert.match(migrationSql, /REVOKE UPDATE, DELETE ON "audit_events"/);
  assert.doesNotMatch(migrationSql, /current_user|session_user|CREATE TABLE/i);
});

test("audit integrity backout preserves every audit row and table", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0018_audit_integrity.sql"),
    "utf8",
  );

  assert.match(backoutSql, /DROP TRIGGER IF EXISTS/);
  assert.match(backoutSql, /DROP FUNCTION IF EXISTS/);
  assert.doesNotMatch(backoutSql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});
