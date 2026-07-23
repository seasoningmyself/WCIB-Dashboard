import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIT_ACTIONS } from "../../shared/audit-events.js";
import { SUPPORT_AUDIT_CATEGORIES } from "../../shared/support-dashboard.js";
import type { ClosedKpiFact } from "../kpi/closed-facts.js";
import { buildPaySheetPolicySnapshot } from "../pay-sheets/snapshots.js";
import {
  AUDIT_CATEGORY_BY_ACTION,
  buildSupportKpiCalculation,
} from "./aggregates.js";
import { SupportDashboardBoundsError } from "./errors.js";

test("support KPI diagnostics expose counts and health without financial values", () => {
  const result = buildSupportKpiCalculation(
    { period: "Q3", year: 2026 },
    [
      fact(7, "New", "150.00", "2026-07-31T12:00:00.000Z"),
      fact(7, "Won Back", "80.00", "2026-08-01T12:00:00.000Z"),
    ],
    [
      { month: 7, recordCount: 2, status: "closed" },
      { month: 8, recordCount: 0, status: "closed" },
      { month: 9, recordCount: 0, status: "closed" },
    ],
    new Date("2026-10-01T12:00:00.000Z"),
  );

  assert.deepEqual(result, {
    firstAnomalyMonth: null,
    lastSuccessfulCalculationAt: "2026-10-01T12:00:00.000Z",
    missingOrIncompletePeriods: [],
    monthly: [
      { month: 7, newPolicyCount: 1, policyCount: 2, reportingStatus: "complete" },
      { month: 8, newPolicyCount: 0, policyCount: 0, reportingStatus: "complete" },
      { month: 9, newPolicyCount: 0, policyCount: 0, reportingStatus: "complete" },
    ],
    period: "Q3",
    reconciliationVariance: "none",
    recordsProcessed: 2,
    source: "closed_pay_sheets",
    status: "healthy",
    totals: {
      newPolicyCount: 1,
      policyCount: 2,
      retentionRate: "50.00",
      wonBackCount: 1,
    },
    year: 2026,
  });

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "Commission",
    "Individual Insured",
    "PRIVATE-POLICY",
    "Producer Person",
    "commissionAmount",
    "agencyRevenue",
    "insuredName",
    "newRevenue",
    "officeLocationId",
    "paySheetId",
    "policyNumber",
    "producerPayout",
    "producerUserId",
    "sophiaShare",
    "wonBackRevenue",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("support KPI diagnostics identify stale and mismatched reporting periods", () => {
  const facts = [fact(7, "New", "150.00", "2026-07-31T12:00:00.000Z")];
  const calculatedAt = new Date("2026-10-01T12:00:00.000Z");
  const stale = buildSupportKpiCalculation(
    { period: "Q3", year: 2026 },
    facts,
    [
      { month: 7, recordCount: 1, status: "closed" },
      { month: 8, recordCount: 0, status: "open" },
    ],
    calculatedAt,
  );
  assert.equal(stale.status, "stale");
  assert.equal(stale.firstAnomalyMonth, 8);
  assert.deepEqual(stale.missingOrIncompletePeriods, [
    { month: 8, status: "incomplete" },
    { month: 9, status: "missing" },
  ]);

  const mismatched = buildSupportKpiCalculation(
    { period: "Q3", year: 2026 },
    facts,
    [
      { month: 7, recordCount: 2, status: "closed" },
      { month: 8, recordCount: 0, status: "closed" },
      { month: 9, recordCount: 0, status: "closed" },
    ],
    calculatedAt,
  );
  assert.equal(mismatched.status, "mismatched");
  assert.equal(mismatched.reconciliationVariance, "detected");
  assert.equal(mismatched.firstAnomalyMonth, 7);
});

test("support aggregate category map is exhaustive and fixed", () => {
  assert.deepEqual(
    Object.keys(AUDIT_CATEGORY_BY_ACTION).sort(),
    [...AUDIT_ACTIONS].sort(),
  );
  assert.deepEqual(
    [...new Set(Object.values(AUDIT_CATEGORY_BY_ACTION))].sort(),
    [...SUPPORT_AUDIT_CATEGORIES].sort(),
  );
  assert.equal(
    AUDIT_CATEGORY_BY_ACTION.user_mfa_challenge_failed,
    "mfa",
  );
  assert.equal(
    AUDIT_CATEGORY_BY_ACTION.producer_commission_receipt_marked,
    "financial_workflow",
  );
});

test("support KPI diagnostics reject facts outside the selected period", () => {
  assert.throws(
    () =>
      buildSupportKpiCalculation(
        { period: "Q3", year: 2026 },
        [fact(6, "New", "10.00", "2026-06-30T12:00:00.000Z")],
        [],
        new Date("2026-10-01T12:00:00.000Z"),
      ),
    SupportDashboardBoundsError,
  );
});

function fact(
  month: number,
  transactionType: string,
  agencyRevenue: string,
  closedAt: string,
): ClosedKpiFact {
  return {
    addedAt: new Date("2026-07-01T12:00:00.000Z"),
    closedAt: new Date(closedAt),
    ownerType: "sophia",
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    paySheetId: "00000000-0000-4000-8000-000000000002",
    paySheetPolicyId: `00000000-0000-4000-8000-0000000000${month}`,
    periodMonth: month,
    periodYear: 2026,
    snapshot: buildPaySheetPolicySnapshot({
      approvedAt: "2026-07-01T12:00:00.000Z",
      brokerFee: "0.00",
      commissionAmount: agencyRevenue,
      effectiveDate: "2026-07-01",
      insuredName: "Individual Insured",
      kayleeSplit: "book",
      officeLocationId: "00000000-0000-4000-8000-000000000003",
      policyId: "00000000-0000-4000-8000-000000000004",
      policyNumber: "PRIVATE-POLICY",
      policyTypeClass: "Commercial",
      policyTypeName: "Commercial Package",
      producerPayout: "37.50",
      producerUserId: "00000000-0000-4000-8000-000000000005",
      sophiaShare: "112.50",
      transactionType,
    }),
  };
}
