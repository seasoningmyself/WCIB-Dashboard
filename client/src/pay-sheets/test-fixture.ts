import type {
  PaySheetAdjustmentView,
  PaySheetDetail,
  PaySheetListResponse,
  PaySheetPolicyView,
  PaySheetSummary,
} from "../../../shared/pay-sheet-api.js";

export function paySheetPolicyFixture(
  overrides: Partial<PaySheetPolicyView> = {},
): PaySheetPolicyView {
  return {
    addedAt: "2026-07-02T00:00:00.000Z",
    agencyRevenue: "150.00",
    associationId: uuid(20),
    approvedAt: "2026-07-01T12:00:00.000Z",
    brokerFee: "50.00",
    commissionAmount: "100.00",
    effectiveDate: "2026-07-01",
    insuredName: "Acme Construction",
    kayleeSplit: "book",
    officeLocationId: uuid(6),
    policyId: uuid(21),
    policyNumber: "GL-100",
    policyTypeClass: "Commercial",
    policyTypeName: "General Liability",
    producerDisplayName: "Kaylee",
    producerPayout: "50.00",
    producerUserId: uuid(2),
    rate: {
      effectiveDate: "2026-01-01",
      newBrokerRate: "50.00",
      newCommissionRate: "25.00",
      renewalBrokerRate: "30.00",
      renewalCommissionRate: "20.00",
    },
    sophiaShare: "112.50",
    source: "live",
    transactionType: "New",
    ...overrides,
  };
}

export function paySheetAdjustmentFixture(
  overrides: Partial<PaySheetAdjustmentView> = {},
): PaySheetAdjustmentView {
  return {
    accountBasis: "own",
    adjustmentType: "check_income",
    brokerFeeDelta: "0.00",
    commissionDelta: "0.00",
    createdAt: "2026-07-03T12:00:00.000Z",
    createdByUserId: uuid(1),
    effectiveDate: "2026-07-03",
    id: uuid(30),
    incomeAmount: "100.00",
    insuredOrClientLabel: "Direct-pay client",
    paySheetId: uuid(10),
    payoutDelta: "0.00",
    policyTypeId: null,
    policyTypeName: null,
    producerDisplayName: null,
    producerUserId: null,
    reasonOrNote: "Check received directly",
    sourceAdjustmentId: null,
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides,
  };
}

export function sophiaSummaryFixture(
  overrides: Partial<Extract<PaySheetSummary, { ownerType: "sophia" }>> = {},
): Extract<PaySheetSummary, { ownerType: "sophia" }> {
  return {
    adjustmentCount: 1,
    closeBlocker: null,
    closedAt: null,
    closedByUserId: null,
    id: uuid(10),
    openedAt: "2026-07-01T00:00:00.000Z",
    ownerDisplayName: "Sophia",
    ownerType: "sophia",
    ownerUserId: uuid(1),
    periodMonth: 7,
    periodYear: 2026,
    policyCount: 1,
    status: "open",
    totals: sophiaTotals(),
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides,
  };
}

export function producerSummaryFixture(
  overrides: Partial<Extract<PaySheetSummary, { ownerType: "producer" }>> = {},
): Extract<PaySheetSummary, { ownerType: "producer" }> {
  return {
    adjustmentCount: 1,
    closeBlocker: null,
    closedAt: null,
    closedByUserId: null,
    id: uuid(11),
    openedAt: "2026-07-01T00:00:00.000Z",
    ownerDisplayName: "Kaylee",
    ownerType: "producer",
    ownerUserId: uuid(2),
    periodMonth: 7,
    periodYear: 2026,
    policyCount: 1,
    status: "open",
    totals: producerTotals(),
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides,
  };
}

export function paySheetDetailFixture(
  summary: PaySheetSummary = sophiaSummaryFixture(),
): PaySheetDetail {
  const policy = paySheetPolicyFixture({
    associationId: uuid(summary.ownerType === "sophia" ? 20 : 22),
    rate: summary.ownerType === "producer" ? paySheetPolicyFixture().rate : null,
    source: summary.status === "closed" ? "frozen" : "live",
  });
  const adjustment = paySheetAdjustmentFixture({
    paySheetId: summary.id,
    producerDisplayName:
      summary.ownerType === "producer" ? summary.ownerDisplayName : null,
    producerUserId:
      summary.ownerType === "producer" ? summary.ownerUserId : null,
    accountBasis: summary.ownerType === "producer" ? "book" : "own",
    adjustmentType:
      summary.ownerType === "producer" ? "chargeback" : "check_income",
    incomeAmount: summary.ownerType === "producer" ? "0.00" : "100.00",
    payoutDelta: summary.ownerType === "producer" ? "-5.00" : "0.00",
  });
  return { ...summary, adjustments: [adjustment], policies: [policy] } as PaySheetDetail;
}

export function paySheetListFixture(): PaySheetListResponse {
  const sophiaOpen = sophiaSummaryFixture();
  const producerOpen = producerSummaryFixture();
  const sophiaClosed = sophiaSummaryFixture({
    closedAt: "2026-06-30T23:59:00.000Z",
    closedByUserId: uuid(1),
    id: uuid(12),
    periodMonth: 6,
    status: "closed",
  });
  return {
    items: [sophiaOpen, sophiaClosed, producerOpen],
    query: {
      ownerType: "all",
      ownerUserId: null,
      periodMonth: null,
      periodYear: null,
      status: "all",
    },
  };
}

function sophiaTotals() {
  return {
    brokerFees: "50.00",
    commissions: "100.00",
    directCheckAchIncome: "100.00",
    grandTotalIncome: "250.00",
    sophiaAgencyGross: "250.00",
    sophiaShare: "112.50",
    sophiaTakeHome: "212.50",
    trustPull: "150.00",
  };
}

function producerTotals() {
  return {
    brokerFees: "50.00",
    commissions: "100.00",
    directCheckAchIncome: "0.00",
    grandTotalIncome: "150.00",
    producerPayout: "45.00",
    trustPull: "150.00",
  };
}

export function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
