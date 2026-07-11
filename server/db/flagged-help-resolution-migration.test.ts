import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationName = "0036_flagged_help_resolution.sql";
const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle", migrationName),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout", migrationName),
  "utf8",
);

function enumBlock(sql: string): string {
  return (
    sql.match(
      /CREATE TYPE "public"\."audit_action" AS ENUM\([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

test("one migration owns the flagged-help withdrawal audit action", () => {
  const owners = readdirSync(resolve(process.cwd(), "drizzle"))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .filter((name) => {
      const forward = readFileSync(
        resolve(process.cwd(), "drizzle", name),
        "utf8",
      );
      const backout = readFileSync(
        resolve(process.cwd(), "drizzle/backout", name),
        "utf8",
      );
      return (
        enumBlock(forward).includes("'draft_help_withdrawn'") &&
        !enumBlock(backout).includes("'draft_help_withdrawn'")
      );
    });

  assert.deepEqual(owners, [migrationName]);
  assert.doesNotMatch(migrationSql, /ALTER TYPE[\s\S]*ADD VALUE/i);
});

test("migration adds narrow locked trusted transitions with atomic audits", () => {
  assert.match(
    migrationSql,
    /CREATE FUNCTION "send_back_flagged_draft"\([\s\S]*?SECURITY DEFINER/,
  );
  assert.match(
    migrationSql,
    /CREATE FUNCTION "withdraw_flagged_help"\([\s\S]*?SECURITY DEFINER/,
  );
  assert.match(
    migrationSql,
    /send_back_flagged_draft[\s\S]*?require_lifecycle_admin[\s\S]*?FOR UPDATE[\s\S]*?transition_draft_status[\s\S]*?'flagged',[\s\S]*?'sent_back'[\s\S]*?SET "flag_reason" = NULL[\s\S]*?record_audit_event[\s\S]*?'draft_sent_back'[\s\S]*?'draft'/,
  );
  assert.match(
    migrationSql,
    /withdraw_flagged_help[\s\S]*?require_lifecycle_staff[\s\S]*?"owner_user_id"[\s\S]*?FOR UPDATE[\s\S]*?draft_owner_user_id <> p_actor_user_id[\s\S]*?transition_draft_status[\s\S]*?'flagged',[\s\S]*?'draft'[\s\S]*?record_audit_event[\s\S]*?'draft_help_withdrawn'/,
  );
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION "send_back_flagged_draft"/,
  );
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION "withdraw_flagged_help"/,
  );
});

test("migration leaves the lifecycle matrix and pending queue path unchanged", () => {
  assert.doesNotMatch(
    migrationSql,
    /CREATE OR REPLACE FUNCTION "transition_draft_status"/,
  );
  assert.doesNotMatch(migrationSql, /send_back_queued_draft/);
  assert.doesNotMatch(migrationSql, /resolve_queued_policy_approval/);
  assert.doesNotMatch(
    migrationSql,
    /ALTER TABLE "approval_queue_entries"|ALTER TABLE "policies"/,
  );
});

test("pre-use backout preserves resolution history and removes only new surfaces", () => {
  assert.match(backoutSql, /'draft_help_withdrawn'/);
  assert.match(
    backoutSql,
    /"action" = 'draft_sent_back'[\s\S]*?"entity_type" = 'draft'/,
  );
  assert.match(backoutSql, /preserve it and forward-fix/);
  assert.match(backoutSql, /ERRCODE = '55000'/);
  assert.match(backoutSql, /DROP FUNCTION "withdraw_flagged_help"/);
  assert.match(backoutSql, /DROP FUNCTION "send_back_flagged_draft"/);
  assert.doesNotMatch(enumBlock(backoutSql), /draft_help_withdrawn/);
  assert.doesNotMatch(
    backoutSql,
    /DELETE FROM "audit_events"|TRUNCATE|DROP TABLE|ALTER TABLE "drafts"/i,
  );
});
