import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePaySheetAdjustmentForOwner,
  paySheetAdjustmentDeleteRequestSchema,
  paySheetAdjustmentInputSchema,
} from "./pay-sheet-adjustment-api.js";

test("Sophia corrections accept exact non-positive financial shapes", () => {
  assert.deepEqual(
    parsePaySheetAdjustmentForOwner(
      adjustment({
        accountBasis: "book",
        brokerFeeDelta: "-10.00",
        commissionDelta: "-20.00",
        producerUserId: uuid(2),
      }),
      "sophia",
    ),
    adjustment({
      accountBasis: "book",
      brokerFeeDelta: "-10.00",
      commissionDelta: "-20.00",
      producerUserId: uuid(2),
    }),
  );
  assert.throws(() =>
    parsePaySheetAdjustmentForOwner(
      adjustment({ payoutDelta: "-1.00" }),
      "sophia",
    ),
  );
});

test("producer corrections accept payout reductions only", () => {
  assert.equal(
    parsePaySheetAdjustmentForOwner(
      adjustment({
        accountBasis: "book",
        brokerFeeDelta: "0.00",
        payoutDelta: "-25.00",
        producerUserId: uuid(2),
      }),
      "producer",
    ).payoutDelta,
    "-25.00",
  );
  for (const input of [
    adjustment({ brokerFeeDelta: "-1.00", payoutDelta: "0.00" }),
    adjustment({ commissionDelta: "-1.00", payoutDelta: "0.00" }),
    directIncome(),
  ]) {
    assert.throws(() => parsePaySheetAdjustmentForOwner(input, "producer"));
  }
});

test("direct income is exact, positive, own-account, and unclassified", () => {
  assert.equal(
    parsePaySheetAdjustmentForOwner(directIncome(), "sophia").incomeAmount,
    "100.00",
  );
  for (const input of [
    directIncome({ incomeAmount: "0.00" }),
    directIncome({ brokerFeeDelta: "-1.00" }),
    directIncome({ policyTypeId: uuid(3) }),
    directIncome({ producerUserId: uuid(2) }),
  ]) {
    assert.equal(paySheetAdjustmentInputSchema.safeParse(input).success, false);
  }
});

test("adjustment inputs trim bounded text and reject forged system fields", () => {
  const parsed = paySheetAdjustmentInputSchema.parse(
    adjustment({
      insuredOrClientLabel: "  Client name  ",
      reasonOrNote: "  Correction reason  ",
    }),
  );
  assert.equal(parsed.insuredOrClientLabel, "Client name");
  assert.equal(parsed.reasonOrNote, "Correction reason");
  for (const forged of [
    { createdAt: "2026-07-01T00:00:00.000Z" },
    { createdByUserId: uuid(9) },
    { id: uuid(8) },
    { paySheetId: uuid(7) },
    { updatedAt: "2026-07-01T00:00:00.000Z" },
  ]) {
    assert.equal(
      paySheetAdjustmentInputSchema.safeParse({ ...adjustment(), ...forged })
        .success,
      false,
    );
  }
  assert.equal(
    paySheetAdjustmentDeleteRequestSchema.safeParse({ paySheetId: uuid(1) })
      .success,
    false,
  );
});

test("invalid dates, money, account links, and no-op corrections reject", () => {
  for (const input of [
    adjustment({ effectiveDate: "07/01/2026" }),
    adjustment({ brokerFeeDelta: "-1" }),
    adjustment({ brokerFeeDelta: "0.00" }),
    adjustment({ accountBasis: "book" }),
    adjustment({ accountBasis: "own", producerUserId: uuid(2) }),
    adjustment({ insuredOrClientLabel: " " }),
    adjustment({ reasonOrNote: "x".repeat(2001) }),
  ]) {
    assert.equal(paySheetAdjustmentInputSchema.safeParse(input).success, false);
  }
});

function adjustment(overrides: Record<string, unknown> = {}) {
  return {
    accountBasis: "own",
    adjustmentType: "chargeback",
    brokerFeeDelta: "-10.00",
    commissionDelta: "0.00",
    effectiveDate: "2026-07-10",
    incomeAmount: "0.00",
    insuredOrClientLabel: "Client name",
    payoutDelta: "0.00",
    policyTypeId: null,
    producerUserId: null,
    reasonOrNote: null,
    ...overrides,
  };
}

function directIncome(overrides: Record<string, unknown> = {}) {
  return adjustment({
    adjustmentType: "check_income",
    brokerFeeDelta: "0.00",
    incomeAmount: "100.00",
    ...overrides,
  });
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
