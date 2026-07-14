import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationName = "0043_policy_change_requests.sql";
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

test("0043 owns the complete policy change-request schema and vocabulary", () => {
  assert.doesNotMatch(migrationSql, /ALTER TYPE[\s\S]*ADD VALUE/i);
  for (const action of [
    "policy_change_request_created",
    "policy_change_request_corrected",
    "policy_change_request_resolved_as_is",
    "policy_change_request_sent_back",
  ]) {
    assert.match(enumBlock(migrationSql, "audit_action"), new RegExp(action));
    assert.doesNotMatch(enumBlock(backoutSql, "audit_action"), new RegExp(action));
  }
  assert.match(
    enumBlock(migrationSql, "audit_entity_type"),
    /policy_change_request/,
  );
  assert.match(migrationSql, /CREATE TABLE "policy_change_requests"/);
  assert.match(migrationSql, /policy_change_requests_pending_policy_idx/);
  assert.match(migrationSql, /policy_change_requests_state_check/);
});

test("0043 exposes only trusted owner creation and admin resolution paths", () => {
  assert.match(
    migrationSql,
    /enforce_policy_change_request_write_path[\s\S]*?trusted creation path[\s\S]*?trusted resolution path[\s\S]*?DELETE/,
  );
  assert.match(
    migrationSql,
    /create_policy_change_request[\s\S]*?require_lifecycle_staff[\s\S]*?submitted_by_user_id[\s\S]*?policy_change_request_owner_required/,
  );
  for (const name of [
    "resolve_policy_change_request_as_is",
    "send_back_policy_change_request",
    "resolve_corrected_policy_change_request",
  ]) {
    assert.match(
      migrationSql,
      new RegExp(`${name}[\\s\\S]*?require_lifecycle_admin[\\s\\S]*?FOR UPDATE`),
    );
    assert.match(migrationSql, new RegExp(`REVOKE ALL ON FUNCTION "${name}"`));
  }
  const correctedFunction = migrationSql.slice(
    migrationSql.indexOf('CREATE FUNCTION "resolve_corrected_policy_change_request"'),
  );
  assert.match(correctedFunction, /p_mutation_kind = 'general'[\s\S]*?policy_corrected/);
  assert.match(correctedFunction, /policy_overrides[\s\S]*?policy_override_applied/);
});

test("0043 audits each transition and refuses destructive backout after use", () => {
  for (const action of [
    "policy_change_request_created",
    "policy_change_request_corrected",
    "policy_change_request_resolved_as_is",
    "policy_change_request_sent_back",
  ]) {
    assert.match(migrationSql, new RegExp(`record_audit_event[\\s\\S]*?'${action}'`));
    assert.match(backoutSql, new RegExp(`'${action}'`));
  }
  assert.match(backoutSql, /policy change-request history is in use/);
  assert.match(backoutSql, /preserve it and forward-fix/);
  assert.doesNotMatch(backoutSql, /DELETE FROM|TRUNCATE/i);
});
