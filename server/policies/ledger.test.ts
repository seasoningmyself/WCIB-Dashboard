import assert from "node:assert/strict";
import { test } from "node:test";
import type { PolicyLedgerSourceItem } from "./ledger.js";
import {
  calculateLedgerTotals,
  classifyLedgerDuplicates,
  normalizeLedgerSearch,
  sortLedgerRows,
} from "./ledger.js";
import type { PolicyRecord } from "../db/schema.js";

test("ledger duplicate classification matches insured, policy, and accounting", () => {
  const first = item("00000000-0000-4000-8000-000000000011", {
    insuredName: "  ACME   Construction ",
    policyNumber: " GL-100 ",
  });
  const likely = item("00000000-0000-4000-8000-000000000012", {
    insuredName: "acme construction",
    policyNumber: "gl-100",
  });
  const possible = item("00000000-0000-4000-8000-000000000013", {
    amountPaid: "400.00",
    insuredName: "Acme Construction",
    policyNumber: "GL-100",
  });
  const distinct = item("00000000-0000-4000-8000-000000000014", {
    insuredName: "Acme Construction",
    policyNumber: "GL-101",
  });
  const duplicates = classifyLedgerDuplicates([
    withoutDuplicate(first),
    withoutDuplicate(likely),
    withoutDuplicate(possible),
    withoutDuplicate(distinct),
  ]);

  assert.deepEqual(duplicates.get(first.policy.id), {
    count: 3,
    kind: "likely",
  });
  assert.deepEqual(duplicates.get(likely.policy.id), {
    count: 3,
    kind: "likely",
  });
  assert.deepEqual(duplicates.get(possible.policy.id), {
    count: 3,
    kind: "possible",
  });
  assert.equal(duplicates.has(distinct.policy.id), false);
  assert.equal(normalizeLedgerSearch("  ACME   Construction "), "acme construction");
});

test("ledger sorting is deterministic for every v15 key", () => {
  const alpha = item("00000000-0000-4000-8000-000000000021", {
    approvedAt: new Date("2026-07-02T12:00:00.000Z"),
    insuredName: "Alpha",
    transactionType: "Renewal",
  });
  const beta = item(
    "00000000-0000-4000-8000-000000000022",
    {
      approvedAt: new Date("2026-07-01T12:00:00.000Z"),
      insuredName: "Beta",
      transactionType: "Audit",
    },
    { mgaName: "A MGA", submitterDisplayName: "Zed" },
  );
  const gamma = item(
    "00000000-0000-4000-8000-000000000023",
    {
      approvedAt: new Date("2026-07-01T12:00:00.000Z"),
      insuredName: "Gamma",
      kayleeSplit: "book",
      transactionType: "New",
    },
    {
      mgaName: "Z MGA",
      producerDisplayName: "Kaylee",
      submitterDisplayName: "Amy",
    },
  );
  const rows = [gamma, beta, alpha];

  assert.deepEqual(ids(sortLedgerRows(rows, query("date", "desc"))), [
    alpha.policy.id,
    beta.policy.id,
    gamma.policy.id,
  ]);
  assert.deepEqual(ids(sortLedgerRows(rows, query("insured", "asc"))), [
    alpha.policy.id,
    beta.policy.id,
    gamma.policy.id,
  ]);
  assert.deepEqual(ids(sortLedgerRows(rows, query("mga", "asc"))), [
    beta.policy.id,
    alpha.policy.id,
    gamma.policy.id,
  ]);
  assert.deepEqual(ids(sortLedgerRows(rows, query("transaction", "asc"))), [
    beta.policy.id,
    gamma.policy.id,
    alpha.policy.id,
  ]);
  assert.deepEqual(ids(sortLedgerRows(rows, query("submitter", "asc"))), [
    gamma.policy.id,
    alpha.policy.id,
    beta.policy.id,
  ]);
  assert.deepEqual(ids(sortLedgerRows(rows, query("account", "asc"))), [
    alpha.policy.id,
    beta.policy.id,
    gamma.policy.id,
  ]);
});

test("ledger totals use exact cents and keep Sophia and producer shares distinct", () => {
  const house = item("00000000-0000-4000-8000-000000000031", {
    amountPaid: "100.01",
    brokerFee: "10.01",
    commissionAmount: "20.02",
    kayleeSplit: "none",
  });
  const producer = item("00000000-0000-4000-8000-000000000032", {
    amountPaid: "200.02",
    brokerFee: "10.01",
    commissionAmount: "20.01",
    kayleeSplit: "book",
  });

  assert.deepEqual(calculateLedgerTotals([house, producer]), {
    agencyRevenue: "60.05",
    amountPaid: "300.03",
    brokerFee: "20.02",
    commissionAmount: "40.03",
    producerPayout: "7.51",
    sophiaRetained: "52.54",
  });
});

function item(
  id: string,
  policyInput: Partial<PolicyRecord> = {},
  labelInput: Partial<PolicyLedgerSourceItem["labels"]> = {},
): PolicyLedgerSourceItem {
  return {
    duplicate: null,
    labels: {
      carrierName: "Carrier",
      mgaName: "MGA",
      officeName: "Office",
      policyTypeClass: "Commercial",
      policyTypeName: "General Liability",
      producerDisplayName: null,
      submitterDisplayName: "Mercedes",
      ...labelInput,
    },
    policy: policy(id, policyInput),
  };
}

function policy(id: string, input: Partial<PolicyRecord>): PolicyRecord {
  const timestamp = new Date("2026-07-01T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "350.00",
    approvedAt: timestamp,
    balanceDueDate: null,
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: "00000000-0000-4000-8000-000000000002",
    collectedToDate: "0.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: timestamp,
    depositOption: "350.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "775.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    id,
    insuredName: "Insured",
    invoiceNumber: null,
    ipfsFinanced: "no",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    kayleeSplit: "none",
    mgaFee: "25.00",
    mgaId: "00000000-0000-4000-8000-000000000003",
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
    officeLocationId: "00000000-0000-4000-8000-000000000004",
    overridden: false,
    payableStatus: "paid",
    paymentMode: "deposit",
    policyNumber: "POL-1",
    policyTypeId: "00000000-0000-4000-8000-000000000005",
    premiumTotal: "0.00",
    producerUserId: null,
    proposalTotal: "1125.00",
    receivableStatus: "paid",
    remittedToMga: "0.00",
    sourceDraftId: null,
    submittedAt: timestamp,
    submittedByUserId: "00000000-0000-4000-8000-000000000001",
    taxes: "50.00",
    transactionNotes: null,
    transactionType: "New",
    updatedAt: timestamp,
    ...input,
  };
}

function withoutDuplicate(
  value: PolicyLedgerSourceItem,
): Omit<PolicyLedgerSourceItem, "duplicate"> {
  const { duplicate: _duplicate, ...source } = value;
  return source;
}

function query(
  sort: "date" | "insured" | "mga" | "transaction" | "submitter" | "account",
  direction: "asc" | "desc",
) {
  return {
    direction,
    duplicates: "all" as const,
    finance: "all" as const,
    limit: 100,
    offset: 0,
    search: "",
    sort,
  };
}

function ids(rows: readonly PolicyLedgerSourceItem[]): string[] {
  return rows.map(({ policy }) => policy.id);
}
