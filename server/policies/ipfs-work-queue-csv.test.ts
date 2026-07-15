import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminLedgerPolicySchema,
  type PolicyLedgerLabels,
} from "../../shared/policy-ledger.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { PolicyRecord } from "../db/schema.js";
import { projectAdminPolicy } from "./projection.js";
import {
  IPFS_WORK_QUEUE_HEADERS,
  renderIpfsWorkQueueCsv,
} from "./ipfs-work-queue-csv.js";

test("IPFS work queue preserves v15 columns, exact money, and CSV safety", () => {
  const policy = projectAdminPolicy(policyRecord(), adminContext());
  assert.ok(policy);
  const csv = renderIpfsWorkQueueCsv([{
    labels: labels(),
    policy: adminLedgerPolicySchema.parse(policy),
  }]);

  assert.equal(IPFS_WORK_QUEUE_HEADERS.length, 47);
  assert.equal(IPFS_WORK_QUEUE_HEADERS[0], "Record ID");
  assert.equal(IPFS_WORK_QUEUE_HEADERS[46], "Notes (WCIB internal)");
  assert.equal(csv.startsWith("\ufeffRecord ID,"), true);
  assert.equal(csv.split("\r\n").length, 2);
  assert.match(csv, /IPFS Fees \(Broker \+ MGA combined\)/);
  assert.match(csv, /,75\.00,/);
  assert.match(csv, /,775\.00,/);
  assert.match(csv, /,125\.00,12\.50,175\.00,43\.75,131\.25,/);
  assert.match(csv, /'=FORMULA LLC/);
  assert.match(csv, /'\+Unsafe Carrier/);
  assert.match(csv, /"Line one, ""quoted""\nLine two"/);
  assert.doesNotMatch(csv, /passwordHash|must-not-leak/);
});

test("house work-queue rows retain all agency revenue and no producer payout", () => {
  const projected = projectAdminPolicy(
    policyRecord({ kayleeSplit: "none", producerUserId: null }),
    adminContext(),
  );
  assert.ok(projected);
  const csv = renderIpfsWorkQueueCsv([{
    labels: { ...labels(), producerDisplayName: null },
    policy: adminLedgerPolicySchema.parse(projected),
  }]);
  assert.match(csv, /,175\.00,0\.00,175\.00,House account,/);
});

function labels(): PolicyLedgerLabels {
  return {
    carrierName: "+Unsafe Carrier",
    mgaName: "MGA",
    officeName: "Main Office",
    policyTypeClass: "Commercial",
    policyTypeName: "General Liability",
    producerDisplayName: "Kaylee",
    submitterDisplayName: "Mercedes",
  };
}

function policyRecord(overrides: Partial<PolicyRecord> = {}): PolicyRecord {
  const at = new Date("2026-07-11T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "300.00",
    approvedAt: at,
    balanceDueDate: null,
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: uuid(1),
    collectedToDate: "0.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: at,
    deleteReason: null,
    deletedAt: null,
    deletedByUserId: null,
    depositOption: "300.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "775.00",
    financeContact: {
      address: "10 Main Street",
      email: "insured@example.test",
      mobile: "555-0100",
    },
    financeMeta: {
      billingType: "invoice",
      loanType: "commercial",
      minEarnedAmt: null,
      minEarnedPct: null,
    },
    financeReference: "IPFS-100",
    id: uuid(10),
    insuredName: "=FORMULA LLC",
    invoiceNumber: "INV-100",
    ipfsFinanced: "yes",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: "returning",
    kayleeSplit: "book",
    mgaFee: "25.00",
    mgaId: uuid(2),
    mgaPaid: false,
    mgaPaidAt: null,
    mgaPayReference: null,
    netDue: "175.00",
    netDueTotal: "0.00",
    notes: "Line one, \"quoted\"\nLine two",
    officeLocationId: uuid(3),
    overridden: false,
    payableStatus: "paid",
    paymentMode: "deposit",
    policyNumber: "GL-100",
    policyTypeId: uuid(4),
    premiumTotal: "0.00",
    producerCommissionReceivedAt: null,
    producerUserId: uuid(5),
    proposalTotal: "1075.00",
    receivableStatus: "paid",
    remittedToMga: "0.00",
    sourceDraftId: null,
    submittedAt: at,
    submittedByUserId: uuid(6),
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
      userId: uuid(9),
    },
  } as AuthorizedRequestContext;
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
