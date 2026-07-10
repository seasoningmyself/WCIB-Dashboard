import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePolicyPaymentBalances } from "./payment-stub.js";

test("payment balances are derived from true inputs without floating-point drift", () => {
  assert.deepEqual(
    calculatePolicyPaymentBalances({
      collectedToDate: "300.00",
      netDueTotal: "700.00",
      premiumTotal: "1000.00",
      remittedToMga: "200.00",
    }),
    {
      balanceDueFromInsured: "700.00",
      remainingNetDue: "500.00",
    },
  );
  assert.deepEqual(
    calculatePolicyPaymentBalances({
      collectedToDate: "0.03",
      netDueTotal: "0.10",
      premiumTotal: "0.10",
      remittedToMga: "0.03",
    }),
    {
      balanceDueFromInsured: "0.07",
      remainingNetDue: "0.07",
    },
  );
});

test("payment balance calculation fails closed for malformed or inverted inputs", () => {
  assert.throws(
    () =>
      calculatePolicyPaymentBalances({
        collectedToDate: "10.01",
        netDueTotal: "0.00",
        premiumTotal: "10.00",
        remittedToMga: "0.00",
      }),
    RangeError,
  );
  assert.throws(
    () =>
      calculatePolicyPaymentBalances({
        collectedToDate: "0.00",
        netDueTotal: "0.00",
        premiumTotal: "10.001",
        remittedToMga: "0.00",
      }),
    TypeError,
  );
});
