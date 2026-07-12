import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PAY_SHEET_POLICY_SNAPSHOT_FIELDS } from "../../shared/pay-sheet-snapshots.js";
import { buildPaySheetPolicySnapshot } from "../pay-sheets/snapshots.js";
import {
  deriveClosedKpiActualInputs,
  listAllClosedProducerKpiFacts,
  listClosedKpiFacts,
  type ClosedKpiFact,
  type KpiFactDatabase,
} from "./closed-facts.js";

const source = readFileSync(
  resolve(process.cwd(), "server/kpi/closed-facts.ts"),
  "utf8",
);

function fact(
  transactionType: string,
  agencyRevenue: string,
): ClosedKpiFact {
  const snapshot = buildPaySheetPolicySnapshot({
    approvedAt: "2026-07-01T12:00:00.000Z",
    brokerFee: "0.00",
    commissionAmount: agencyRevenue,
    effectiveDate: "2026-07-01",
    insuredName: "KPI Snapshot Insured",
    kayleeSplit: "book",
    officeLocationId: "00000000-0000-4000-8000-000000000004",
    policyId: "00000000-0000-4000-8000-000000000001",
    policyNumber: "KPI-SNAPSHOT",
    policyTypeClass: "Commercial",
    policyTypeName: "General Liability",
    producerPayout: "37.50",
    producerUserId: "00000000-0000-4000-8000-000000000002",
    sophiaShare: "112.50",
    transactionType,
  });
  return {
    addedAt: new Date("2026-07-31T12:00:00.000Z"),
    ownerType: "sophia",
    ownerUserId: "00000000-0000-4000-8000-000000000003",
    paySheetId: "00000000-0000-4000-8000-000000000005",
    paySheetPolicyId: "00000000-0000-4000-8000-000000000006",
    periodMonth: 7,
    periodYear: 2026,
    snapshot,
  };
}

test("KPI snapshot source contains every approved scope and measure field", () => {
  for (const field of [
    "producerUserId",
    "officeLocationId",
    "policyTypeName",
    "policyTypeClass",
    "transactionType",
    "effectiveDate",
    "approvedAt",
    "agencyRevenue",
    "producerPayout",
    "sophiaShare",
  ]) {
    assert.ok(PAY_SHEET_POLICY_SNAPSHOT_FIELDS.includes(field as never), field);
  }
  assert.equal(PAY_SHEET_POLICY_SNAPSHOT_FIELDS.includes("rewriteSubtype" as never), false);
});

test("KPI inputs keep Won Back distinct and treat only New as new business", () => {
  const inputs = deriveClosedKpiActualInputs([
    fact("New", "150.00"),
    fact("Won Back", "50.00"),
  ]);

  assert.equal(inputs.newPolicyCount, 1);
  assert.equal(inputs.newRevenueCents, 15_000n);
  assert.equal(inputs.retentionNumerator, 1);
  assert.equal(inputs.retentionDenominator, 2);
  assert.deepEqual(inputs.transactionTypeCounts, { New: 1, "Won Back": 1 });
});

test("KPI repository is structurally limited to closed snapshot relations", () => {
  assert.match(source, /\.from\(paySheetPolicies\)/);
  assert.match(source, /\.innerJoin\(paySheets,/);
  assert.match(source, /eq\(paySheets\.status, "closed"\)/);
  assert.doesNotMatch(
    source,
    /\.(?:from|innerJoin|leftJoin|rightJoin)\(\s*policies\b/,
  );
  assert.doesNotMatch(
    source,
    /import\s*\{[^}]*\bpolicies\b[^}]*\}\s*from\s*"\.\.\/db\/schema\.js"/s,
  );
  assert.doesNotMatch(source, /paySheetAdjustments/);
  assert.match(source, /eq\(paySheets\.ownerType, "producer"\)/);
});

test("KPI fact scopes fail before querying on invalid identity or time", async () => {
  const unreachableDatabase = {} as KpiFactDatabase;

  await assert.rejects(
    listClosedKpiFacts(unreachableDatabase, {
      scopeType: "company",
      year: 1999,
    }),
    /year/,
  );
  await assert.rejects(
    listClosedKpiFacts(unreachableDatabase, {
      producerUserId: "not-a-uuid",
      scopeType: "producer",
      year: 2026,
    }),
    /UUID/,
  );
  await assert.rejects(
    listClosedKpiFacts(unreachableDatabase, {
      periodMonths: [],
      scopeType: "company",
      year: 2026,
    }),
    /period months/,
  );
  await assert.rejects(
    listClosedKpiFacts(unreachableDatabase, {
      periodMonths: [13],
      scopeType: "company",
      year: 2026,
    }),
    /period months/,
  );
  await assert.rejects(
    listAllClosedProducerKpiFacts(unreachableDatabase, {
      periodMonths: [0],
      year: 2026,
    }),
    /period months/,
  );
});
