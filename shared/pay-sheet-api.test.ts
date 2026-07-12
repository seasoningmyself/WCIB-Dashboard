import assert from "node:assert/strict";
import { test } from "node:test";
import {
  paySheetCloseRequestSchema,
  paySheetCloseResponseSchema,
  paySheetDetailSchema,
  paySheetListQuerySchema,
  paySheetSophiaTotalsSchema,
  paySheetSummarySchema,
} from "./pay-sheet-api.js";

test("pay-sheet query filters are bounded and default to all owners and states", () => {
  assert.deepEqual(paySheetListQuerySchema.parse({}), {
    ownerType: "all",
    ownerUserId: null,
    periodMonth: null,
    periodYear: null,
    status: "all",
  });
  assert.deepEqual(
    paySheetListQuerySchema.parse({
      ownerType: "producer",
      periodMonth: "7",
      periodYear: "2026",
      status: "closed",
    }),
    {
      ownerType: "producer",
      ownerUserId: null,
      periodMonth: 7,
      periodYear: 2026,
      status: "closed",
    },
  );
  assert.throws(() => paySheetListQuerySchema.parse({ periodMonth: 13 }));
  assert.throws(() => paySheetListQuerySchema.parse({ privateField: true }));
});

test("Sophia totals preserve agency gross, take-home, and share independently", () => {
  const totals = paySheetSophiaTotalsSchema.parse({
    brokerFees: "50.00",
    commissions: "80.00",
    directCheckAchIncome: "100.00",
    grandTotalIncome: "230.00",
    sophiaAgencyGross: "230.00",
    sophiaShare: "92.50",
    sophiaTakeHome: "192.50",
    trustPull: "130.00",
  });

  assert.equal(totals.sophiaAgencyGross, "230.00");
  assert.equal(totals.sophiaTakeHome, "192.50");
  assert.equal(totals.sophiaShare, "92.50");
  assert.notEqual(totals.sophiaAgencyGross, totals.sophiaTakeHome);
});

test("producer sheets with policies and no effective rate require unavailable totals", () => {
  const summary = summaryFixture();
  assert.equal(paySheetSummarySchema.parse(summary).totals, null);
  assert.throws(() =>
    paySheetSummarySchema.parse({
      ...summary,
      closeBlocker: null,
    }),
  );
  assert.throws(() =>
    paySheetDetailSchema.parse({
      ...summary,
      adjustments: [],
      policies: [],
      totals: producerTotals(),
    }),
  );
});

test("pay-sheet close accepts no client-authored financial state", () => {
  assert.deepEqual(paySheetCloseRequestSchema.parse({}), {});
  for (const field of [
    "actorUserId",
    "closedAt",
    "frozenTotals",
    "nextSheetId",
    "ownerUserId",
    "rates",
    "snapshots",
  ]) {
    assert.equal(
      paySheetCloseRequestSchema.safeParse({ [field]: "forged" }).success,
      false,
    );
  }
});

test("pay-sheet close response requires a closed source and matching next sheet", () => {
  const closedSheet = sophiaSummary({ status: "closed" });
  const nextSheet = sophiaSummary({
    closeBlocker: "empty",
    id: uuid(2),
    periodMonth: 8,
    policyCount: 0,
    status: "open",
    totals: zeroSophiaTotals(),
  });
  const response = {
    close: {
      closed: true,
      nextSheetId: nextSheet.id,
      ownerType: "sophia",
      periodMonth: 7,
      periodYear: 2026,
      policyCount: 1,
    },
    closedSheet: { ...closedSheet, adjustments: [], policies: [policy()] },
    nextSheet,
  };
  assert.equal(paySheetCloseResponseSchema.safeParse(response).success, true);
  assert.equal(
    paySheetCloseResponseSchema.safeParse({
      ...response,
      nextSheet: { ...nextSheet, id: uuid(3) },
    }).success,
    false,
  );
});

function summaryFixture() {
  return {
    adjustmentCount: 0,
    closeBlocker: "missing_rate" as const,
    closedAt: null,
    closedByUserId: null,
    id: uuid(1),
    openedAt: "2026-07-01T00:00:00.000Z",
    ownerDisplayName: "Kaylee",
    ownerType: "producer" as const,
    ownerUserId: uuid(2),
    periodMonth: 7,
    periodYear: 2026,
    policyCount: 1,
    status: "open" as const,
    totals: null,
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

function producerTotals() {
  return {
    brokerFees: "50.00",
    commissions: "100.00",
    directCheckAchIncome: "0.00",
    grandTotalIncome: "150.00",
    producerPayout: "37.50",
    trustPull: "150.00",
  };
}

function sophiaSummary(overrides: Record<string, unknown> = {}) {
  return {
    adjustmentCount: 0,
    closeBlocker: null,
    closedAt: "2026-07-31T12:00:00.000Z",
    closedByUserId: uuid(9),
    id: uuid(1),
    openedAt: "2026-07-01T00:00:00.000Z",
    ownerDisplayName: "Sophia",
    ownerType: "sophia",
    ownerUserId: uuid(9),
    periodMonth: 7,
    periodYear: 2026,
    policyCount: 1,
    status: "closed",
    totals: {
      brokerFees: "50.00",
      commissions: "100.00",
      directCheckAchIncome: "100.00",
      grandTotalIncome: "250.00",
      sophiaAgencyGross: "250.00",
      sophiaShare: "112.50",
      sophiaTakeHome: "212.50",
      trustPull: "150.00",
    },
    updatedAt: "2026-07-31T12:00:00.000Z",
    ...overrides,
  };
}

function zeroSophiaTotals() {
  return {
    brokerFees: "0.00",
    commissions: "0.00",
    directCheckAchIncome: "0.00",
    grandTotalIncome: "0.00",
    sophiaAgencyGross: "0.00",
    sophiaShare: "0.00",
    sophiaTakeHome: "0.00",
    trustPull: "0.00",
  };
}

function policy() {
  return {
    addedAt: "2026-07-02T00:00:00.000Z",
    agencyRevenue: "150.00",
    associationId: uuid(10),
    approvedAt: "2026-07-01T12:00:00.000Z",
    brokerFee: "50.00",
    commissionAmount: "100.00",
    effectiveDate: "2026-07-01",
    insuredName: "Frozen Insured",
    kayleeSplit: "book",
    officeLocationId: uuid(8),
    policyId: uuid(11),
    policyNumber: "POL-FROZEN",
    policyTypeClass: "Commercial",
    policyTypeName: "General Liability",
    producerPayout: "0.00",
    producerUserId: uuid(2),
    rate: null,
    sophiaShare: "112.50",
    source: "frozen",
    transactionType: "New",
  };
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
