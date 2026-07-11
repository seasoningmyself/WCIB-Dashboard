import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mgaPayableItemSchema,
  mgaPayableListQuerySchema,
  mgaPayableListResponseSchema,
} from "./mga-payables.js";

const ID = "00000000-0000-4000-8000-000000000001";

test("MGA payable contracts default to unpaid and reject undeclared fields", () => {
  assert.deepEqual(mgaPayableListQuerySchema.parse({}), {
    status: "unpaid",
  });
  assert.throws(() =>
    mgaPayableListQuerySchema.parse({ status: "unpaid", raw: true }),
  );

  const item = mgaPayableItemSchema.parse({
    accountAssignment: "book",
    approvedAt: new Date("2026-07-11T12:00:00.000Z"),
    insuredName: "Acme",
    kayleeSplit: "book",
    mgaId: ID,
    mgaName: "A MGA",
    netDue: "125.50",
    overridden: true,
    paidAt: null,
    paymentReference: null,
    policyId: ID,
    policyNumber: "GL-100",
    policyTypeName: "General Liability",
    producerDisplayName: "Kaylee",
    producerUserId: ID,
    status: "unpaid",
    transactionType: "New",
  });
  assert.equal(item.approvedAt, "2026-07-11T12:00:00.000Z");
  assert.equal("amountPaid" in item, false);
  assert.equal("commissionAmount" in item, false);
});

test("MGA payable response totals require exact decimal money strings", () => {
  const response = mgaPayableListResponseSchema.parse({
    groups: [],
    status: "all",
    summary: {
      outstandingAmount: "0.00",
      paidAmount: "10.01",
      paidCount: 1,
      totalCount: 1,
      unpaidCount: 0,
    },
  });
  assert.equal(response.summary.paidAmount, "10.01");
  assert.throws(() =>
    mgaPayableListResponseSchema.parse({
      ...response,
      summary: { ...response.summary, paidAmount: "10.001" },
    }),
  );
});
