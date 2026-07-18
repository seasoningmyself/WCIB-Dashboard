import type {
  PaySheetAdjustmentView,
  PaySheetDetail,
  PaySheetPolicyView,
  PaySheetSummary,
} from "../../shared/pay-sheet-api.js";
import type { PaySheetSource } from "./read.js";

export function exportPolicyFixture(
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

export function exportAdjustmentFixture(
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

export function exportSophiaSummary(
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
    totals: {
      brokerFees: "50.00",
      commissions: "100.00",
      directCheckAchIncome: "100.00",
      grandTotalIncome: "250.00",
      sophiaAgencyGross: "250.00",
      sophiaShare: "112.50",
      sophiaTakeHome: "212.50",
      trustPull: "150.00",
    },
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides,
  };
}

export function exportProducerSummary(
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
    totals: {
      brokerFees: "50.00",
      commissions: "100.00",
      directCheckAchIncome: "0.00",
      grandTotalIncome: "150.00",
      producerPayout: "45.00",
      trustPull: "150.00",
    },
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides,
  };
}

export function exportDetailFixture(
  summary: PaySheetSummary = exportSophiaSummary(),
  policyOverrides: Partial<PaySheetPolicyView> = {},
  adjustmentOverrides: Partial<PaySheetAdjustmentView> = {},
): PaySheetDetail {
  const policy = exportPolicyFixture({
    associationId: uuid(summary.ownerType === "sophia" ? 20 : 22),
    rate: summary.ownerType === "producer" ? exportPolicyFixture().rate : null,
    source: summary.status === "closed" ? "frozen" : "live",
    ...policyOverrides,
  });
  const adjustment = exportAdjustmentFixture({
    accountBasis: summary.ownerType === "producer" ? "book" : "own",
    adjustmentType: summary.ownerType === "producer" ? "chargeback" : "check_income",
    incomeAmount: summary.ownerType === "producer" ? "0.00" : "100.00",
    paySheetId: summary.id,
    payoutDelta: summary.ownerType === "producer" ? "-5.00" : "0.00",
    producerDisplayName: summary.ownerType === "producer" ? summary.ownerDisplayName : null,
    producerUserId: summary.ownerType === "producer" ? summary.ownerUserId : null,
    ...adjustmentOverrides,
  });
  return { ...summary, adjustments: [adjustment], policies: [policy] } as PaySheetDetail;
}

export function exportSourceFixture(
  detail: PaySheetDetail = exportDetailFixture(),
): PaySheetSource {
  if (detail.status !== "open") {
    throw new Error("Export source fixture supports open sheets only");
  }
  const rate = detail.ownerType === "producer" ? detail.policies[0]?.rate : null;
  return {
    adjustments: detail.adjustments.map((adjustment) => ({
      adjustment: {
        ...adjustment,
        createdAt: new Date(adjustment.createdAt),
        updatedAt: new Date(adjustment.updatedAt),
      },
      policyTypeName: adjustment.policyTypeName,
      producerDisplayName: adjustment.producerDisplayName,
    })),
    header: {
      ownerDisplayName: detail.ownerDisplayName,
      ownerEmail: `${detail.ownerUserId}@example.test`,
      sheet: {
        closedAt: null,
        closedByUserId: null,
        createdAt: new Date(detail.openedAt),
        frozenTotals: null,
        id: detail.id,
        openedAt: new Date(detail.openedAt),
        ownerType: detail.ownerType,
        ownerUserId: detail.ownerUserId,
        periodMonth: detail.periodMonth,
        periodYear: detail.periodYear,
        status: "open",
        updatedAt: new Date(detail.updatedAt),
      },
    },
    policies: detail.policies.map((policy) => ({
      kind: "live" as const,
      value: {
        addedAt: new Date(policy.addedAt),
        associationId: policy.associationId,
        approvedAt: new Date(policy.approvedAt),
        brokerFee: policy.brokerFee,
        commissionAmount: policy.commissionAmount,
        effectiveDate: policy.effectiveDate,
        insuredName: policy.insuredName,
        kayleeSplit: policy.kayleeSplit,
        officeLocationId: policy.officeLocationId,
        policyId: policy.policyId,
        policyNumber: policy.policyNumber,
        policyTypeClass: policy.policyTypeClass,
        policyTypeName: policy.policyTypeName,
        producerDisplayName: policy.producerDisplayName,
        producerUserId: policy.producerUserId,
        transactionType: policy.transactionType,
      },
    })),
    rate: rate === null || rate === undefined
      ? null
      : {
          ...rate,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          id: uuid(detail.ownerType === "producer" ? 40 : 41),
          lockedAt: null,
          producerUserId: detail.ownerUserId,
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
  };
}

export function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
