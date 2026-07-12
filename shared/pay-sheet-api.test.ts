import assert from "node:assert/strict";
import { test } from "node:test";
import {
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

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
