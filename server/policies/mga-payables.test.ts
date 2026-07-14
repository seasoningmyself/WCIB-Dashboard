import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { PolicyRecord } from "../db/schema.js";
import {
  MgaPayableConsistencyError,
  buildMgaPayableListResponse,
  calculateMgaPayableTotals,
  projectAdminMgaPayable,
  type MgaPayableSourceItem,
} from "./mga-payables.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const MGA_A = "00000000-0000-4000-8000-000000000010";
const MGA_B = "00000000-0000-4000-8000-000000000011";

test("MGA payable projection is admin-only and uses stored net due", () => {
  const source = sourceItem({
    amountPaid: "9999.99",
    brokerFee: "9999.99",
    commissionAmount: "9999.99",
    netDue: "123.45",
  });
  const projected = projectAdminMgaPayable(source, adminContext());
  assert.ok(projected);
  assert.equal(projected.netDue, "123.45");
  assert.equal("amountPaid" in projected, false);
  assert.equal("brokerFee" in projected, false);
  assert.equal("commissionAmount" in projected, false);
  assert.equal(
    projectAdminMgaPayable(source, producerContext()),
    null,
  );
});

test("MGA payable totals use exact cents and filters retain total definitions", () => {
  const items = [
    projectedItem({
      insuredName: "Zulu",
      mgaId: MGA_B,
      mgaName: "Bravo MGA",
      netDue: "0.10",
      policyId: "00000000-0000-4000-8000-000000000101",
      status: "unpaid",
    }),
    projectedItem({
      insuredName: "alpha",
      mgaId: MGA_A,
      mgaName: "Alpha MGA",
      netDue: "0.20",
      policyId: "00000000-0000-4000-8000-000000000102",
      status: "paid",
    }),
    projectedItem({
      insuredName: "Beta",
      mgaId: MGA_A,
      mgaName: "Alpha MGA",
      netDue: "90071992547409.91",
      policyId: "00000000-0000-4000-8000-000000000103",
      status: "unpaid",
    }),
  ];

  assert.deepEqual(calculateMgaPayableTotals(items), {
    outstandingAmount: "90071992547410.01",
    paidAmount: "0.20",
    paidCount: 1,
    totalCount: 3,
    unpaidCount: 2,
  });
  const unpaid = buildMgaPayableListResponse(items, "unpaid");
  const paid = buildMgaPayableListResponse(items, "paid");
  assert.deepEqual(unpaid.summary, paid.summary);
  assert.deepEqual(
    unpaid.groups.map((group) => group.mgaName),
    ["Alpha MGA", "Bravo MGA"],
  );
  assert.deepEqual(
    unpaid.groups[0]?.items.map((item) => item.insuredName),
    ["Beta"],
  );
  assert.deepEqual(unpaid.groups[0]?.totals, {
    outstandingAmount: "90071992547409.91",
    paidAmount: "0.20",
    paidCount: 1,
    totalCount: 2,
    unpaidCount: 1,
  });
  assert.equal(paid.groups.length, 1);
  assert.equal(paid.groups[0]?.items[0]?.insuredName, "alpha");
});

test("MGA payable projection rejects policy/payment mirror drift", () => {
  const source = sourceItem({ mgaPaid: true });
  assert.throws(
    () => projectAdminMgaPayable(source, adminContext()),
    MgaPayableConsistencyError,
  );
});

function projectedItem(
  overrides: Partial<NonNullable<ReturnType<typeof projectAdminMgaPayable>>>,
) {
  const projected = projectAdminMgaPayable(sourceItem(), adminContext());
  assert.ok(projected);
  return { ...projected, ...overrides };
}

function sourceItem(overrides: Partial<PolicyRecord> = {}): MgaPayableSourceItem {
  const policy = policyRecord(overrides);
  return {
    labels: {
      mgaName: "Alpha MGA",
      policyTypeName: "General Liability",
      producerDisplayName: "Kaylee",
    },
    payment: null,
    policy,
  };
}

function policyRecord(overrides: Partial<PolicyRecord> = {}): PolicyRecord {
  const at = new Date("2026-07-11T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "350.00",
    approvedAt: at,
    balanceDueDate: null,
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: "00000000-0000-4000-8000-000000000020",
    collectedToDate: "0.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: at,
    depositOption: "350.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "0.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    id: "00000000-0000-4000-8000-000000000100",
    insuredName: "Acme",
    invoiceNumber: null,
    ipfsFinanced: null,
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    kayleeSplit: "book",
    mgaFee: "25.00",
    mgaId: MGA_A,
    mgaPaid: false,
    mgaPaidAt: null,
    producerCommissionReceivedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    deleteReason: null,
    mgaPayReference: null,
    netDue: "175.00",
    netDueTotal: "0.00",
    notes: null,
    officeLocationId: "00000000-0000-4000-8000-000000000021",
    overridden: false,
    payableStatus: "paid",
    paymentMode: "full",
    policyNumber: "GL-100",
    policyTypeId: "00000000-0000-4000-8000-000000000022",
    premiumTotal: "0.00",
    producerUserId: PRODUCER_ID,
    proposalTotal: "1075.00",
    receivableStatus: "paid",
    remittedToMga: "0.00",
    sourceDraftId: null,
    submittedAt: at,
    submittedByUserId: ADMIN_ID,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "New",
    updatedAt: at,
    ...overrides,
  };
}

function adminContext(): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId: ADMIN_ID,
    },
  };
}

function producerContext(): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole: "producer",
      userActive: true,
      userId: PRODUCER_ID,
    },
  };
}
