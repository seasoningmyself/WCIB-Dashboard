import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaySheetFrozenTotals } from "./frozen-totals.js";

test("Sophia frozen totals preserve agency gross and take-home separately", () => {
  const totals = buildPaySheetFrozenTotals("sophia", {
    brokerFees: "1000.00",
    commissions: "500.00",
    directCheckAchIncome: "200.00",
    grandTotalIncome: "1700.00",
    sophiaAgencyGross: "1700.00",
    sophiaShare: "1200.00",
    sophiaTakeHome: "1400.00",
    trustPull: "1500.00",
  });

  assert.equal(totals.sophiaAgencyGross, "1700.00");
  assert.equal(totals.sophiaTakeHome, "1400.00");
  assert.notEqual(totals.sophiaAgencyGross, totals.sophiaTakeHome);
  assert.equal(Object.isFrozen(totals), true);
});

test("producer frozen totals use the exact payout contract", () => {
  assert.deepEqual(
    buildPaySheetFrozenTotals("producer", {
      brokerFees: "250.00",
      commissions: "100.00",
      directCheckAchIncome: "0.00",
      grandTotalIncome: "350.00",
      producerPayout: "87.50",
      trustPull: "350.00",
    }),
    {
      brokerFees: "250.00",
      commissions: "100.00",
      directCheckAchIncome: "0.00",
      grandTotalIncome: "350.00",
      producerPayout: "87.50",
      trustPull: "350.00",
    },
  );
});

test("frozen totals reject malformed, mismatched, and inconsistent values", () => {
  const validSophia = {
    brokerFees: "1000.00",
    commissions: "500.00",
    directCheckAchIncome: "200.00",
    grandTotalIncome: "1700.00",
    sophiaAgencyGross: "1700.00",
    sophiaShare: "1200.00",
    sophiaTakeHome: "1400.00",
    trustPull: "1500.00",
  };

  assert.throws(
    () =>
      buildPaySheetFrozenTotals("sophia", {
        ...validSophia,
        producerPayout: "10.00",
      }),
    /owner-specific field contract/,
  );
  assert.throws(
    () =>
      buildPaySheetFrozenTotals("sophia", {
        ...validSophia,
        sophiaTakeHome: 1400,
      }),
    /canonical money/,
  );
  assert.throws(
    () =>
      buildPaySheetFrozenTotals("sophia", {
        ...validSophia,
        sophiaShare: "-0.00",
      }),
    /negative zero/,
  );
  assert.throws(
    () =>
      buildPaySheetFrozenTotals("sophia", {
        ...validSophia,
        trustPull: "1499.99",
      }),
    /Trust pull/,
  );
  assert.throws(
    () =>
      buildPaySheetFrozenTotals("sophia", {
        ...validSophia,
        grandTotalIncome: "1699.99",
        sophiaAgencyGross: "1699.99",
      }),
    /Grand total income/,
  );
  assert.throws(
    () =>
      buildPaySheetFrozenTotals("sophia", {
        ...validSophia,
        sophiaAgencyGross: "1699.99",
      }),
    /agency gross/,
  );
});
