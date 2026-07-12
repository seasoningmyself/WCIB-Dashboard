import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationName = "0037_producer_commission_received.sql";
const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle", migrationName),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout", migrationName),
  "utf8",
);

test("one migration owns producer commission receipt storage", () => {
  const owners = readdirSync(resolve(process.cwd(), "drizzle"))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .filter((name) =>
      readFileSync(resolve(process.cwd(), "drizzle", name), "utf8").includes(
        'ADD COLUMN "producer_commission_received_at"',
      ),
    );

  assert.deepEqual(owners, [migrationName]);
  assert.equal(
    [...migrationSql.matchAll(/producer_commission_received_at/g)].length,
    1,
  );
  assert.match(
    migrationSql,
    /ALTER TABLE "policies" ADD COLUMN "producer_commission_received_at" timestamp with time zone;/,
  );
});

test("receipt migration is storage-only and preserves every existing guard", () => {
  assert.doesNotMatch(
    migrationSql,
    /NOT NULL|DEFAULT|CREATE TABLE|CREATE TYPE|CREATE FUNCTION|CREATE TRIGGER|DROP |audit_action/i,
  );
  assert.doesNotMatch(
    migrationSql,
    /pay_sheet|mga_payment|producer_rate|policy_override/i,
  );
});

test("receipt backout refuses data loss and removes only its column", () => {
  assert.match(
    backoutSql,
    /WHERE "producer_commission_received_at" IS NOT NULL/,
  );
  assert.match(backoutSql, /preserve financial history and forward-fix/);
  assert.match(backoutSql, /ERRCODE = '55000'/);
  assert.match(
    backoutSql,
    /DROP COLUMN IF EXISTS "producer_commission_received_at"/,
  );
  assert.doesNotMatch(
    backoutSql,
    /DELETE FROM|UPDATE |TRUNCATE|DROP TABLE|DROP TYPE|DROP FUNCTION|DROP TRIGGER/i,
  );
});
