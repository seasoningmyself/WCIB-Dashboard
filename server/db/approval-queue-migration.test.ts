import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("one migration owns the approval queue table and snapshot protections", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const tableCreators = readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .filter((fileName) =>
      /CREATE TABLE "approval_queue_entries"/.test(
        readFileSync(resolve(migrationDirectory, fileName), "utf8"),
      ),
    );

  assert.deepEqual(tableCreators, ["0014_approval_queue.sql"]);

  const migrationSql = readFileSync(
    resolve(migrationDirectory, "0014_approval_queue.sql"),
    "utf8",
  );
  assert.match(
    migrationSql,
    /CREATE TYPE "public"\."approval_queue_status" AS ENUM\('pending', 'sent_back', 'flagged'\)/,
  );
  assert.match(migrationSql, /"submitted_payload" jsonb NOT NULL/);
  assert.match(migrationSql, /approval_queue_entries_active_draft_idx/);
  assert.match(migrationSql, /CREATE TRIGGER "approval_queue_integrity_trigger"/);
  assert.match(migrationSql, /CONSTRAINT = 'approval_queue_payload_immutable'/);
  assert.doesNotMatch(
    migrationSql,
    /submitted_by_name|acted_by_name|CREATE TABLE "policies"/i,
  );
});

test("approval queue backout drops only its table, trigger, function, and enum", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0014_approval_queue.sql"),
    "utf8",
  );

  assert.match(backoutSql, /DROP TRIGGER IF EXISTS/);
  assert.match(backoutSql, /DROP FUNCTION IF EXISTS/);
  assert.match(backoutSql, /DROP TABLE IF EXISTS "approval_queue_entries"/);
  assert.match(backoutSql, /DROP TYPE IF EXISTS "approval_queue_status"/);
  assert.doesNotMatch(backoutSql, /DROP TABLE IF EXISTS "drafts"/);
});
