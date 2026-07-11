import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { POLICY_CORRECTION_FIELDS } from "../../shared/policy-corrections.js";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0034_policy_correction.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0034_policy_correction.sql"),
  "utf8",
);
const correctionFunctionSql =
  migrationSql.match(
    /CREATE FUNCTION "apply_policy_correction"[\s\S]*?REVOKE ALL ON FUNCTION "apply_policy_correction"[\s\S]*?FROM PUBLIC;/,
  )?.[0] ?? "";
const policyUpdateSql =
  correctionFunctionSql.match(
    /UPDATE "policies"[\s\S]*?WHERE "id" = p_policy_id;/,
  )?.[0] ?? "";

test("one migration owns the audited policy correction path", () => {
  assert.notEqual(correctionFunctionSql, "");
  assert.match(
    correctionFunctionSql,
    /"p_expected_updated_at" timestamp with time zone/,
  );
  assert.match(correctionFunctionSql, /FOR UPDATE/);
  assert.match(correctionFunctionSql, /ERRCODE = '40001'/);
  assert.match(correctionFunctionSql, /'policy_corrected'/);
  assert.match(correctionFunctionSql, /"record_audit_event"/);
  assert.match(correctionFunctionSql, /policy_correction_context/);
  assert.match(migrationSql, /policy_correction_write_path_trigger/);
  assert.match(migrationSql, /REVOKE UPDATE \(/);
  assert.match(
    migrationSql,
    /CREATE OR REPLACE FUNCTION "enforce_policy_override_write_path"/,
  );
  assert.doesNotMatch(correctionFunctionSql, /apply_policy_override/);
});

test("policy correction SQL updates only the explicit allowlist and derived totals", () => {
  assert.notEqual(policyUpdateSql, "");
  for (const field of POLICY_CORRECTION_FIELDS) {
    assert.match(correctionFunctionSql, new RegExp(`'${field}'`));
  }
  for (const column of ["proposal_total", "finance_balance", "updated_at"]) {
    assert.match(policyUpdateSql, new RegExp(`"${column}"`));
  }
  for (const forbiddenColumn of [
    "commission_amount",
    "broker_fee",
    "net_due",
    "commission_mode",
    "overridden",
    "mga_paid",
    "mga_pay_reference",
    "mga_paid_at",
    "ipfs_pushed",
    "ipfs_pushed_at",
    "premium_total",
    "collected_to_date",
    "net_due_total",
    "remitted_to_mga",
    "receivable_status",
    "payable_status",
    "balance_due_date",
    "source_draft_id",
    "submitted_by_user_id",
    "submitted_at",
    "approved_at",
    "created_at",
  ]) {
    assert.doesNotMatch(policyUpdateSql, new RegExp(`"${forbiddenColumn}"`));
  }
});

test("policy correction backout is pre-use and restores the override guard", () => {
  assert.match(backoutSql, /WHERE "action" = 'policy_corrected'/);
  assert.match(backoutSql, /preserve policy and audit history and forward-fix/);
  assert.match(backoutSql, /DROP TRIGGER IF EXISTS "policy_correction_write_path_trigger"/);
  assert.match(backoutSql, /DROP FUNCTION IF EXISTS "apply_policy_correction"/);
  assert.match(
    backoutSql,
    /CREATE OR REPLACE FUNCTION "enforce_policy_override_write_path"/,
  );
  assert.doesNotMatch(backoutSql, /DELETE FROM|UPDATE "policies"|TRUNCATE/i);
});
