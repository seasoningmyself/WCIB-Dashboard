import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0021_policy_overrides.sql"),
  "utf8",
);

test("one migration owns the bounded policy override table", () => {
  const migrations = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^0021_.*\.sql$/.test(name),
  );
  assert.deepEqual(migrations, ["0021_policy_overrides.sql"]);
  assert.match(migrationSql, /CREATE TABLE "policy_overrides"/);
  for (const column of [
    "id",
    "policy_id",
    "reason",
    "original_values",
    "replacement_values",
    "approved_by_user_id",
    "created_at",
  ]) {
    assert.match(migrationSql, new RegExp(`"${column}"`));
  }
  assert.equal(
    [...migrationSql.matchAll(/REFERENCES "public"\."(?:policies|users)"/g)]
      .length,
    2,
  );
  assert.equal([...migrationSql.matchAll(/ON DELETE restrict/g)].length, 2);
  assert.equal(
    [...migrationSql.matchAll(/<> '\{\}'::jsonb/g)].length,
    2,
  );
  assert.match(migrationSql, /pg_column_size[\s\S]*<= 4096/);
  for (const field of [
    "commissionAmount",
    "brokerFee",
    "netDue",
    "commissionMode",
  ]) {
    assert.match(migrationSql, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(
    migrationSql,
    /ALTER TABLE "policies" ADD COLUMN|CREATE FUNCTION|CREATE TRIGGER|carrier_fee|budget/i,
  );
});

test("policy override backout is scoped to the new table", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0021_policy_overrides.sql"),
    "utf8",
  );

  assert.match(backoutSql, /DROP TABLE IF EXISTS "policy_overrides"/);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE.*(?:policies|users|audit_events)|DELETE FROM|TRUNCATE/i,
  );
});
