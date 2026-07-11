import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateAgencyCommissionAmount,
  calculateDraftFinanceBalance,
  calculateDraftNetDue,
} from "./draft-calculations.js";

test("draft calculations use deterministic cent rounding", () => {
  assert.equal(
    calculateAgencyCommissionAmount({
      basePremium: "1000.00",
      commissionMode: "pct",
      commissionRate: "12.5000",
    }),
    "125.00",
  );
  assert.equal(
    calculateAgencyCommissionAmount({
      basePremium: "0.05",
      commissionMode: "pct",
      commissionRate: "10.0000",
    }),
    "0.01",
  );
  assert.equal(
    calculateAgencyCommissionAmount({
      basePremium: "1000.00",
      commissionMode: "tbd",
      commissionRate: null,
    }),
    "0.00",
  );
  assert.equal(
    calculateDraftNetDue({
      agencyCommissionAmount: "125.00",
      amountPaid: "500.00",
      brokerFee: "50.00",
    }),
    "325.00",
  );
  assert.equal(
    calculateDraftFinanceBalance({
      amountPaid: "300.00",
      paymentMode: "deposit",
      proposalTotal: "1080.00",
    }),
    "780.00",
  );
});

test("incomplete or invalid draft calculation inputs remain unset", () => {
  assert.equal(
    calculateAgencyCommissionAmount({
      basePremium: null,
      commissionMode: "pct",
      commissionRate: "10.0000",
    }),
    null,
  );
  assert.equal(
    calculateDraftNetDue({
      agencyCommissionAmount: null,
      amountPaid: "100.00",
      brokerFee: "0.00",
    }),
    null,
  );
  assert.equal(
    calculateDraftFinanceBalance({
      amountPaid: "200.00",
      paymentMode: "deposit",
      proposalTotal: "100.00",
    }),
    null,
  );
});
