import type {
  MyCommissionItem,
  MyCommissionsResponse,
} from "../../../shared/my-commissions.js";

export function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function commissionItem(
  overrides: Partial<MyCommissionItem> = {},
): MyCommissionItem {
  return {
    estimate: false,
    id: uuid(1),
    insuredName: "Acme Construction",
    payout: "825.50",
    policyType: "General Liability",
    receivedAt: null,
    section: "owed",
    status: "awaiting_payment",
    transactionType: "New Business",
    ...overrides,
  };
}

export function commissionsResponse(): MyCommissionsResponse {
  return {
    items: [commissionItem()],
    summary: {
      inReviewCount: 0,
      owedAmount: "825.50",
      owedCount: 1,
      paidLast30DaysAmount: "0.00",
      paidLast30DaysCount: 0,
    },
  };
}
