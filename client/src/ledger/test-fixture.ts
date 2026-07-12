import type {
  PolicyLedgerItem,
  PolicyLedgerListResponse,
} from "../../../shared/policy-ledger.js";

export function ledgerItemFixture(): PolicyLedgerItem {
  const timestamp = "2026-07-11T12:00:00.000Z";
  return {
    duplicate: { count: 2, kind: "likely" },
    labels: {
      carrierName: "Carrier",
      mgaName: "MGA",
      officeName: "Office",
      policyTypeClass: "Commercial",
      policyTypeName: "General Liability",
      producerDisplayName: "Kaylee",
      submitterDisplayName: "Mercedes",
    },
    policy: {
      accountAssignment: "book",
      amountPaid: "350.00",
      approvedAt: timestamp,
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
      createdAt: timestamp,
      depositOption: "350.00",
      effectiveDate: "2026-07-01",
      expirationDate: "2027-07-01",
      financeBalance: "725.00",
      financeContact: null,
      financeMeta: null,
      financeReference: null,
      id: uuid(10),
      insuredName: "Insured",
      invoiceNumber: null,
      ipfsFinanced: "yes",
      ipfsManual: false,
      ipfsPushed: false,
      ipfsPushedAt: null,
      ipfsReturning: "new",
      kayleeSplit: "book",
      mgaFee: "25.00",
      mgaId: uuid(2),
      mgaPaid: false,
      mgaPaidAt: null,
      mgaPayReference: null,
      netDue: "175.00",
      netDueTotal: "0.00",
      notes: null,
      officeLocationId: uuid(3),
      overridden: true,
      payableStatus: "paid",
      paymentMode: "deposit",
      policyNumber: "GL-100",
      policyTypeId: uuid(4),
      premiumTotal: "0.00",
      producerUserId: uuid(5),
      proposalTotal: "1075.00",
      receivableStatus: "paid",
      remittedToMga: "0.00",
      sourceDraftId: null,
      submittedAt: timestamp,
      submittedByUserId: uuid(6),
      taxes: "0.00",
      transactionNotes: null,
      transactionType: "New",
      updatedAt: timestamp,
    },
  };
}

export function ledgerListFixture(): PolicyLedgerListResponse {
  return {
    filteredTotal: 1,
    hasMore: false,
    items: [ledgerItemFixture()],
    limit: 100,
    month: "2026-07",
    offset: 0,
    total: 1,
    totals: {
      agencyRevenue: "175.00",
      amountPaid: "350.00",
      brokerFee: "50.00",
      commissionAmount: "125.00",
      producerPayout: "43.75",
      sophiaRetained: "131.25",
    },
  };
}

export function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
