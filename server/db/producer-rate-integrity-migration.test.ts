import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0007_producer_rate_integrity.sql"),
  "utf8",
);

test("producer rate integrity has one explicit migration contract", () => {
  assert.match(
    migrationSql,
    /CREATE TRIGGER "producer_rate_history_integrity_trigger"/,
  );
  assert.match(
    migrationSql,
    /CREATE FUNCTION "lock_producer_rate_history_for_close"/,
  );
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION "lock_producer_rate_history_for_close"/,
  );
  assert.doesNotMatch(migrationSql, /pay_sheets|pay_sheet_policies/i);
  assert.doesNotMatch(migrationSql, /CREATE TABLE/i);
});

test("producer rate integrity backout preserves the table and rows", () => {
  const backoutSql = readFileSync(
    resolve(
      process.cwd(),
      "drizzle/backout/0007_producer_rate_integrity.sql",
    ),
    "utf8",
  );

  assert.match(backoutSql, /DROP TRIGGER IF EXISTS/);
  assert.match(backoutSql, /DROP FUNCTION IF EXISTS/);
  assert.doesNotMatch(backoutSql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});
