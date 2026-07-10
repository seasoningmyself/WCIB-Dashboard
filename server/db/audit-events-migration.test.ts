import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("audit events migration owns the bounded event table", () => {
  const migrationSql = readFileSync(
    resolve(process.cwd(), "drizzle/0017_audit_events.sql"),
    "utf8",
  );

  assert.match(migrationSql, /CREATE TABLE "audit_events"/);
  for (const column of [
    "id",
    "actor_user_id",
    "action",
    "entity_type",
    "entity_id",
    "before_summary",
    "after_summary",
    "occurred_at",
  ]) {
    assert.match(migrationSql, new RegExp(`"${column}"`));
  }
  assert.match(
    migrationSql,
    /FOREIGN KEY \("actor_user_id"\) REFERENCES "public"\."users"\("id"\).*ON DELETE restrict/,
  );
  assert.match(
    migrationSql,
    /jsonb_typeof\("audit_events"\."before_summary"\) = 'object'/,
  );
  assert.match(
    migrationSql,
    /pg_column_size\("audit_events"\."after_summary"\) <= 16384/,
  );
  assert.doesNotMatch(migrationSql, /CREATE TRIGGER|PROCEDURE|FUNCTION/i);
});

test("audit events backout removes only item 15 objects", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0017_audit_events.sql"),
    "utf8",
  );

  assert.match(backoutSql, /DROP TABLE IF EXISTS "audit_events"/);
  assert.match(backoutSql, /DROP TYPE IF EXISTS "audit_action"/);
  assert.match(backoutSql, /DROP TYPE IF EXISTS "audit_entity_type"/);
  assert.doesNotMatch(backoutSql, /DROP TABLE.*users/i);
});
