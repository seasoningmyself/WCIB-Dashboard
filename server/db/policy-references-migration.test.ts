import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const POLICY_REFERENCE_COLUMNS = [
  "source_draft_id",
  "submitted_by_user_id",
  "policy_type_id",
  "carrier_id",
  "mga_id",
  "office_location_id",
  "producer_user_id",
] as const;

test("policy reference migration adds exactly seven restrictive foreign keys", () => {
  const migrationSql = readFileSync(
    resolve(process.cwd(), "drizzle/0019_policy_references.sql"),
    "utf8",
  );
  const constraints = [
    ...migrationSql.matchAll(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g),
  ].map((match) => match[1]);

  assert.equal(constraints.length, POLICY_REFERENCE_COLUMNS.length);
  for (const column of POLICY_REFERENCE_COLUMNS) {
    assert.match(
      migrationSql,
      new RegExp(`FOREIGN KEY \\(\\"${column}\\"\\).*ON DELETE restrict`),
    );
  }
  assert.doesNotMatch(
    migrationSql,
    /CREATE TABLE|ON DELETE cascade|ON DELETE set null|carrier_fee|budget/i,
  );
});

test("policy reference backout removes only the seven owned constraints", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0019_policy_references.sql"),
    "utf8",
  );

  assert.equal(
    [...backoutSql.matchAll(/DROP CONSTRAINT IF EXISTS/g)].length,
    POLICY_REFERENCE_COLUMNS.length,
  );
  assert.doesNotMatch(backoutSql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});
