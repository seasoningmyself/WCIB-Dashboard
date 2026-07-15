import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_MGA_PAYMENT_REFERENCE_LENGTH,
  mgaPayableItemSchema,
  mgaPayableListQuerySchema,
  mgaPayableListResponseSchema,
  mgaPayableStateRequestSchema,
  mgaPayableStateResponseSchema,
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
    amountPaid: "350.00",
    approvedAt: new Date("2026-07-11T12:00:00.000Z"),
    brokerFee: "25.00",
    commissionAmount: "100.00",
    commissionRate: "10.0000",
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
  assert.equal(item.amountPaid, "350.00");
  assert.equal(item.commissionAmount, "100.00");
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

test("MGA payable state requests trim bounded paid references and reject unpaid references", () => {
  assert.deepEqual(
    mgaPayableStateRequestSchema.parse({
      reference: "  WIRE-123  ",
      status: "paid",
    }),
    { reference: "WIRE-123", status: "paid" },
  );
  assert.deepEqual(
    mgaPayableStateRequestSchema.parse({ status: "unpaid" }),
    { reference: null, status: "unpaid" },
  );
  assert.throws(() =>
    mgaPayableStateRequestSchema.parse({
      reference: "not-allowed",
      status: "unpaid",
    }),
  );
  assert.throws(() =>
    mgaPayableStateRequestSchema.parse({
      reference: "x".repeat(MAX_MGA_PAYMENT_REFERENCE_LENGTH + 1),
      status: "paid",
    }),
  );
});

test("MGA payable mutation responses require unique placement IDs and matching counts", () => {
  const item = mgaPayableItemSchema.parse({
    accountAssignment: "none",
    amountPaid: "350.00",
    approvedAt: "2026-07-11T12:00:00.000Z",
    brokerFee: "25.00",
    commissionAmount: "100.00",
    commissionRate: null,
    insuredName: "Acme",
    kayleeSplit: "none",
    mgaId: ID,
    mgaName: "A MGA",
    netDue: "125.50",
    overridden: false,
    paidAt: "2026-07-11T13:00:00.000Z",
    paymentReference: "WIRE-123",
    policyId: ID,
    policyNumber: "GL-100",
    policyTypeName: "General Liability",
    producerDisplayName: null,
    producerUserId: null,
    status: "paid",
    transactionType: "New",
  });
  assert.doesNotThrow(() =>
    mgaPayableStateResponseSchema.parse({
      item,
      placement: { associationCount: 1, paySheetIds: [ID] },
    }),
  );
  assert.throws(() =>
    mgaPayableStateResponseSchema.parse({
      item,
      placement: { associationCount: 2, paySheetIds: [ID, ID] },
    }),
  );
});
