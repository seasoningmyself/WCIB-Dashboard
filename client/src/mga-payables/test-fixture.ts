import type {
  MgaPayableItem,
  MgaPayableListResponse,
} from "../../../shared/mga-payables.js";

export function payableItemFixture(
  overrides: Partial<MgaPayableItem> = {},
): MgaPayableItem {
  return {
    accountAssignment: "book",
    approvedAt: "2026-05-01T12:00:00.000Z",
    insuredName: "Acme Construction",
    kayleeSplit: "book",
    mgaId: uuid(1),
    mgaName: "Alpha Managing General Agency",
    netDue: "850.00",
    overridden: true,
    paidAt: null,
    paymentReference: null,
    policyId: uuid(10),
    policyNumber: "GL-100",
    policyTypeName: "General Liability",
    producerDisplayName: "Kaylee",
    producerUserId: uuid(2),
    status: "unpaid",
    transactionType: "New",
    ...overrides,
  };
}

export function payablesFixture(): MgaPayableListResponse {
  const item = payableItemFixture();
  return {
    groups: [
      {
        items: [item],
        mgaId: item.mgaId,
        mgaName: item.mgaName,
        totals: {
          outstandingAmount: "850.00",
          paidAmount: "0.00",
          paidCount: 0,
          totalCount: 1,
          unpaidCount: 1,
        },
      },
    ],
    status: "unpaid",
    summary: {
      outstandingAmount: "850.00",
      paidAmount: "0.00",
      paidCount: 0,
      totalCount: 1,
      unpaidCount: 1,
    },
  };
}

export function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
