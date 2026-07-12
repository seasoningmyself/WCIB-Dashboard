import type { KpiActualResponse } from "../../../shared/kpi-actuals.js";
import type { KpiTargetListResponse } from "../../../shared/kpi-target-api.js";

export const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";

export function kpiTargetsFixture(): KpiTargetListResponse {
  return {
    items: [
      {
        newPolicyCountTarget: 12,
        newRevenueTarget: "125000.00",
        producerUserId: null,
        retentionRateTarget: "75.00",
        scopeType: "company",
        year: 2026,
      },
      {
        newPolicyCountTarget: 6,
        newRevenueTarget: "60000.00",
        producerUserId: PRODUCER_ID,
        retentionRateTarget: "70.00",
        scopeType: "producer",
        year: 2026,
      },
    ],
    producers: [
      {
        displayName: "Kaylee Producer",
        isActive: true,
        producerUserId: PRODUCER_ID,
      },
    ],
    year: 2026,
  };
}

export function kpiActualsFixture(
  overrides: Partial<KpiActualResponse> = {},
): KpiActualResponse {
  return {
    empty: false,
    monthly: [
      { agencyRevenue: "42000.10", month: 1, newPolicyCount: 2, policyCount: 3, producerPayout: "6000.25" },
      { agencyRevenue: "33000.20", month: 2, newPolicyCount: 1, policyCount: 3, producerPayout: "5200.50" },
      { agencyRevenue: "45000.30", month: 3, newPolicyCount: 2, policyCount: 4, producerPayout: "6800.75" },
    ],
    offices: [
      {
        agencyRevenue: "70000.25",
        displayName: "Main Office With A Deliberately Long Stable Label",
        newPolicyCount: 3,
        officeLocationId: "00000000-0000-4000-8000-000000000003",
        policyCount: 6,
      },
      {
        agencyRevenue: "50000.35",
        displayName: "North Office",
        newPolicyCount: 2,
        officeLocationId: "00000000-0000-4000-8000-000000000004",
        policyCount: 4,
      },
    ],
    period: "Q1",
    producerPayouts: [
      {
        bookPayout: "14000.50",
        displayName: "Kaylee Producer",
        firstYearHousePayout: "4000.00",
        policyCount: 6,
        producerUserId: PRODUCER_ID,
        totalPayout: "18000.50",
      },
    ],
    scope: { displayName: null, producerUserId: null, scopeType: "company" },
    totals: {
      agencyRevenue: "120000.60",
      existingPolicyCount: 5,
      newPolicyCount: 5,
      newRevenue: "82500.40",
      policyCount: 10,
      producerBookPayout: "14000.50",
      producerFirstYearHousePayout: "4000.00",
      producerPayout: "18000.50",
      retentionRate: "50.00",
      wonBackCount: 2,
      wonBackRevenue: "11000.15",
    },
    transactionTypes: [
      { agencyRevenue: "82500.40", policyCount: 5, transactionType: "New" },
      { agencyRevenue: "11000.15", policyCount: 2, transactionType: "Won Back" },
      { agencyRevenue: "26490.05", policyCount: 3, transactionType: "Renewal" },
    ],
    year: 2026,
    ...overrides,
  };
}
