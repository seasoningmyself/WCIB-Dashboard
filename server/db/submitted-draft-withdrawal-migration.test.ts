import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationName = "0042_submitted_draft_withdrawal.sql";
const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle", migrationName),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout", migrationName),
  "utf8",
);

function enumBlock(sql: string, name: string): string {
  return (
    sql.match(
      new RegExp(`CREATE TYPE "public"\\."${name}" AS ENUM\\([\\s\\S]*?\\);`),
    )?.[0] ?? ""
  );
}

test("one migration owns submitted-withdrawal vocabulary", () => {
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
        enumBlock(forward, "audit_action").includes(
          "'draft_submission_withdrawn'",
        ) &&
        enumBlock(forward, "approval_queue_status").includes("'withdrawn'") &&
        !enumBlock(backout, "audit_action").includes(
          "'draft_submission_withdrawn'",
        )
      );
    });

  assert.deepEqual(owners, [migrationName]);
  assert.doesNotMatch(migrationSql, /ALTER TYPE[\s\S]*ADD VALUE/i);
  assert.match(enumBlock(migrationSql, "audit_action"), /draft_submission_withdrawn/);
  assert.match(enumBlock(migrationSql, "approval_queue_status"), /withdrawn/);
});

test("trusted withdrawal locks queue before draft and audits one preserved row", () => {
  const functionSql = migrationSql.slice(
    migrationSql.indexOf('CREATE FUNCTION "withdraw_pending_submission"'),
  );
  const queueLock = functionSql.indexOf('FROM "approval_queue_entries"');
  const draftLock = functionSql.indexOf('FROM "drafts"');

  assert.ok(queueLock >= 0);
  assert.ok(draftLock > queueLock);
  assert.match(functionSql, /FROM "approval_queue_entries"[\s\S]*?FOR UPDATE/);
  assert.match(functionSql, /FROM "drafts"[\s\S]*?FOR UPDATE/);
  assert.match(functionSql, /queue_submitter_user_id <> p_actor_user_id/);
  assert.match(functionSql, /draft_owner_user_id <> p_actor_user_id/);
  assert.match(functionSql, /queue_current_status|"status" = 'pending'/);
  assert.match(functionSql, /SET[\s\S]*?"status" = 'withdrawn'/);
  assert.match(
    functionSql,
    /transition_draft_status[\s\S]*?'submitted'[\s\S]*?'draft'/,
  );
  assert.match(
    functionSql,
    /record_audit_event[\s\S]*?'draft_submission_withdrawn'[\s\S]*?'approval_queue_entry'/,
  );
  assert.match(functionSql, /SECURITY DEFINER/);
  assert.match(functionSql, /REVOKE ALL ON FUNCTION "withdraw_pending_submission"/);
  assert.doesNotMatch(functionSql, /DELETE FROM "approval_queue_entries"/);
});

test("pre-use backout protects history and removes only withdrawal surfaces", () => {
  assert.match(backoutSql, /"status" = 'withdrawn'/);
  assert.match(backoutSql, /"action" = 'draft_submission_withdrawn'/);
  assert.match(backoutSql, /preserve it and forward-fix/);
  assert.match(backoutSql, /ERRCODE = '55000'/);
  assert.match(backoutSql, /DROP FUNCTION "withdraw_pending_submission"/);
  assert.doesNotMatch(
    enumBlock(backoutSql, "audit_action"),
    /draft_submission_withdrawn/,
  );
  assert.doesNotMatch(
    enumBlock(backoutSql, "approval_queue_status"),
    /withdrawn/,
  );
  assert.doesNotMatch(
    backoutSql,
    /DELETE FROM "approval_queue_entries"|DELETE FROM "audit_events"|TRUNCATE|DROP TABLE/i,
  );
});
