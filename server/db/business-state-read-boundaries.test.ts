import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { test } from "node:test";

const scopedIdentifiers = [
  "approvalQueueEntries",
  "drafts",
  "kpiTargets",
  "mgaPayments",
  "paySheetAdjustments",
  "paySheetPolicies",
  "paySheets",
  "policies",
  "policyChangeRequests",
  "policyOverrides",
] as const;

const reviewedReadModules = [
  "server/approval-queue/approve-with-override.ts",
  "server/approval-queue/approve.ts",
  "server/approval-queue/list.ts",
  "server/approval-queue/send-back.ts",
  "server/approval-queue/soft-delete.ts",
  "server/commissions/read.ts",
  "server/commissions/receipts.ts",
  "server/drafts/create.ts",
  "server/drafts/edit.ts",
  "server/drafts/flag.ts",
  "server/drafts/list.ts",
  "server/drafts/my-items.ts",
  "server/drafts/submit.ts",
  "server/drafts/withdraw-help.ts",
  "server/drafts/withdraw-submission.ts",
  "server/kpi/closed-facts.ts",
  "server/kpi/targets.ts",
  "server/pay-sheets/adjustment-target.ts",
  "server/pay-sheets/read.ts",
  "server/policies/ipfs-history.ts",
  "server/policies/ipfs-pushed.ts",
  "server/policies/ledger-corrections.ts",
  "server/policies/ledger.ts",
  "server/policies/lifecycle.ts",
  "server/policies/mga-payables.ts",
  "server/policy-change-requests/service.ts",
] as const;

test("every direct transactional read is reviewed and active-generation scoped", () => {
  const files = productionTypeScriptFiles(resolve(process.cwd(), "server"));
  const directReaders: string[] = [];
  const readPattern = new RegExp(
    `\\.(?:from|innerJoin|leftJoin)\\((?:${scopedIdentifiers.join("|")})\\)`,
  );
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!readPattern.test(source)) continue;
    const name = relative(process.cwd(), file);
    directReaders.push(name);
    assert.match(
      source,
      /inActiveBusinessGeneration/,
      `${name} reads generation-scoped rows without the shared predicate`,
    );
    assert.match(
      source,
      /\.businessGenerationId/,
      `${name} does not bind the predicate to an explicit generation column`,
    );
  }
  assert.deepEqual(directReaders.sort(), [...reviewedReadModules].sort());
});

test("migration guards every scoped table and load-bearing trusted function", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "drizzle/0047_business_state_generations.sql"),
    "utf8",
  );
  const tableNames = [
    "approval_queue_entries",
    "drafts",
    "kpi_targets",
    "mga_payments",
    "pay_sheet_adjustments",
    "pay_sheet_policies",
    "pay_sheets",
    "policies",
    "policy_change_requests",
    "policy_overrides",
  ];
  for (const table of tableNames) {
    assert.match(
      migration,
      new RegExp(`BEFORE INSERT OR UPDATE OR DELETE ON "${table}"`),
    );
    assert.match(
      migration,
      new RegExp(`ALTER TABLE "${table}" ADD COLUMN "business_generation_id"`),
    );
  }
  for (const identity of [
    "initialize_pay_sheet_owner_chain",
    "close_pay_sheet_with_cascade_unlocked",
    "close_pay_sheet_unlocked",
    "sync_mga_payment_sheet_placement_unlocked",
    "sync_mga_payment_sheet_placement_core_unlocked",
    "sync_pay_sheet_chargeback_mirror",
  ]) {
    assert.match(migration, new RegExp(`'${identity}\\(`));
  }
  assert.match(
    migration,
    /FROM "business_state_control" AS control[\s\S]*FOR SHARE/,
  );
  assert.match(
    migration,
    /CREATE FUNCTION "reset_business_state"[\s\S]*FOR UPDATE/,
  );
  assert.match(
    migration,
    /CREATE FUNCTION "restore_business_state"[\s\S]*FOR UPDATE/,
  );
});

function productionTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...productionTypeScriptFiles(path));
    else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".db-test.ts")
    ) {
      files.push(path);
    }
  }
  return files;
}
