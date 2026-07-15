import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateAgencyCommissionAmount,
  calculateDraftFinanceBalance,
  calculateDraftNetDue,
  calculateDraftProposalTotal,
  compareMoney,
  moneyDifferenceInCents,
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
  assert.equal(
    calculateDraftProposalTotal({
      basePremium: "1000.00",
      brokerFee: "50.00",
      mgaFee: null,
      taxes: "30.00",
    }),
    "1080.00",
  );
  assert.equal(compareMoney("1080.00", "1080.00"), 0);
  assert.equal(compareMoney("0.00", "1.00"), -1);
  assert.equal(compareMoney("2.00", "1.00"), 1);
  assert.equal(moneyDifferenceInCents("1080.00", "1080.02"), 2n);
  assert.equal(moneyDifferenceInCents("1080.03", "1080.00"), 3n);
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
  assert.equal(
    calculateDraftProposalTotal({
      basePremium: "10.00",
      brokerFee: null,
      mgaFee: "0.00",
      taxes: "0.00",
    }),
    null,
  );
  assert.equal(compareMoney("invalid", "1.00"), null);
  assert.equal(moneyDifferenceInCents("invalid", "1.00"), null);
});
