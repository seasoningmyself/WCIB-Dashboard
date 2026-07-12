import assert from "node:assert/strict";
import { test } from "node:test";
import { approveWithOverrideRequestSchema } from "./policy-overrides.js";

test("approval override input is a bounded exact financial allowlist", () => {
  assert.deepEqual(
    approveWithOverrideRequestSchema.parse({
      changedFields: ["commissionAmount", "brokerFee"],
      reason: "  Carrier corrected the bound figures  ",
      replacementValues: {
        brokerFee: "30.00",
        commissionAmount: "150.00",
      },
    }),
    {
      changedFields: ["commissionAmount", "brokerFee"],
      reason: "Carrier corrected the bound figures",
      replacementValues: {
        brokerFee: "30.00",
        commissionAmount: "150.00",
      },
    },
  );

  for (const input of [
    {
      changedFields: [],
      reason: "Required",
      replacementValues: {},
    },
    {
      changedFields: ["brokerFee", "brokerFee"],
      reason: "Required",
      replacementValues: { brokerFee: "30.00" },
    },
    {
      changedFields: ["brokerFee"],
      reason: "Required",
      replacementValues: { brokerFee: "30.00", netDue: "70.00" },
    },
    {
      changedFields: ["commissionMode"],
      reason: "Required",
      replacementValues: { commissionMode: "pct" },
    },
    {
      changedFields: ["insuredName"],
      reason: "Required",
      replacementValues: { insuredName: "Private insured" },
    },
    {
      changedFields: ["brokerFee"],
      reason: "   ",
      replacementValues: { brokerFee: "30.00" },
    },
    {
      changedFields: ["brokerFee"],
      reason: "Required",
      replacementValues: { brokerFee: "30" },
    },
  ]) {
    assert.equal(approveWithOverrideRequestSchema.safeParse(input).success, false);
  }
});
