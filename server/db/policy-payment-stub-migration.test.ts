import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const APPROVED_COLUMNS = [
  "premium_total",
  "collected_to_date",
  "net_due_total",
  "remitted_to_mga",
  "receivable_status",
  "payable_status",
  "balance_due_date",
] as const;

test("payment stub migration adds exactly seven approved columns", () => {
  const migrationSql = readFileSync(
    resolve(process.cwd(), "drizzle/0016_policy_payment_stub.sql"),
    "utf8",
  );
  const addedColumns = [...migrationSql.matchAll(/ADD COLUMN "([^"]+)"/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(addedColumns, APPROVED_COLUMNS);
  assert.match(
    migrationSql,
    /CREATE TYPE "public"\."receivable_status" AS ENUM\('paid', 'partial', 'open'\)/,
  );
  assert.match(
    migrationSql,
    /CREATE TYPE "public"\."payable_status" AS ENUM\('paid', 'partially_remitted', 'unpaid'\)/,
  );
  assert.doesNotMatch(
    migrationSql,
    /balance_due_from_insured|remaining_net_due|CREATE TABLE|CREATE TRIGGER/i,
  );
});

test("payment stub backout removes only the seven columns and owned enums", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0016_policy_payment_stub.sql"),
    "utf8",
  );

  for (const column of APPROVED_COLUMNS) {
    assert.match(backoutSql, new RegExp(`DROP COLUMN IF EXISTS "${column}"`));
  }
  assert.match(backoutSql, /DROP TYPE IF EXISTS "receivable_status"/);
  assert.match(backoutSql, /DROP TYPE IF EXISTS "payable_status"/);
  assert.doesNotMatch(backoutSql, /DROP TABLE/);
});
