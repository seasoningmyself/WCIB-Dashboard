import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "drizzle/0033_policy_corrected_audit_action.sql",
  ),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(
    process.cwd(),
    "drizzle/backout/0033_policy_corrected_audit_action.sql",
  ),
  "utf8",
);

test("one migration owns the policy_corrected audit action", () => {
  const owners = readdirSync(resolve(process.cwd(), "drizzle"))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .filter((name) => {
      const sql = readFileSync(
        resolve(process.cwd(), "drizzle", name),
        "utf8",
      );
      const reverseSql = readFileSync(
        resolve(process.cwd(), "drizzle/backout", name),
        "utf8",
      );
      const includesPolicyCorrected =
        /CREATE TYPE[\s\S]*?"audit_action" AS ENUM\([\s\S]*?'policy_corrected'[\s\S]*?\);/;
      return (
        includesPolicyCorrected.test(sql) &&
        !includesPolicyCorrected.test(reverseSql)
      );
    });

  assert.deepEqual(owners, ["0033_policy_corrected_audit_action.sql"]);
  assert.equal(
    [...migrationSql.matchAll(/'policy_corrected'/g)].length,
    1,
  );
});

test("audit vocabulary migration preserves the bounded append-only writer", () => {
  assert.doesNotMatch(migrationSql, /ALTER TYPE[\s\S]*ADD VALUE/i);
  assert.match(
    migrationSql,
    /'admin_policy_submitted',[\s\S]*'policy_corrected'/,
  );
  assert.match(migrationSql, /CREATE FUNCTION "record_audit_event"/);
  assert.match(migrationSql, /pg_column_size\(candidate_summary\) > 16384/);
  assert.match(migrationSql, /summary_field_count > 32/);
  assert.match(migrationSql, /char_length\(entry\.value #>> '\{\}'\) > 500/);
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION "record_audit_event"/,
  );
  assert.doesNotMatch(migrationSql, /CREATE TABLE|ALTER TABLE "policies"/);
});

test("pre-use backout refuses to discard policy correction history", () => {
  assert.match(backoutSql, /WHERE "action" = 'policy_corrected'/);
  assert.match(backoutSql, /preserve audit history and forward-fix/);
  assert.match(backoutSql, /ERRCODE = '55000'/);
  assert.match(backoutSql, /CREATE TYPE "public"\."audit_action" AS ENUM/);
  assert.doesNotMatch(
    backoutSql.match(
      /CREATE TYPE "public"\."audit_action" AS ENUM\([\s\S]*?\);/,
    )?.[0] ?? "",
    /policy_corrected/,
  );
  assert.doesNotMatch(backoutSql, /DELETE FROM "audit_events"|TRUNCATE/i);
});
