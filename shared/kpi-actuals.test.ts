import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KPI_PERIOD_MONTHS,
  kpiActualQuerySchema,
  kpiActualResponseSchema,
} from "./kpi-actuals.js";

const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";

test("KPI actual query requires exact scope, year, and period", () => {
  assert.deepEqual(
    kpiActualQuerySchema.parse({
      period: "Q3",
      scopeType: "company",
      year: "2026",
    }),
    { period: "Q3", scopeType: "company", year: 2026 },
  );
  assert.deepEqual(KPI_PERIOD_MONTHS.Q3, [7, 8, 9]);
  for (const invalid of [
    { period: "Q5", scopeType: "company", year: "2026" },
    { period: "full", scopeType: "producer", year: "2026" },
    {
      period: "full",
      producerUserId: PRODUCER_ID,
      scopeType: "company",
      year: "2026",
    },
    { period: "full", scopeType: "company", year: "1999" },
  ]) assert.equal(kpiActualQuerySchema.safeParse(invalid).success, false);
});

test("KPI actual response requires exact decimal and selected-month contracts", () => {
  const response = {
    empty: true,
    monthly: [1, 2, 3].map((month) => ({
      agencyRevenue: "0.00",
      month,
      newPolicyCount: 0,
      policyCount: 0,
      producerPayout: "0.00",
    })),
    offices: [],
    period: "Q1",
    producerPayouts: [],
    scope: {
      displayName: null,
      producerUserId: null,
      scopeType: "company",
    },
    totals: {
      agencyRevenue: "0.00",
      existingPolicyCount: 0,
      newPolicyCount: 0,
      newRevenue: "0.00",
      policyCount: 0,
      producerBookPayout: "0.00",
      producerFirstYearHousePayout: "0.00",
      producerPayout: "0.00",
      retentionRate: null,
      wonBackCount: 0,
      wonBackRevenue: "0.00",
    },
    transactionTypes: [],
    year: 2026,
  } as const;
  assert.deepEqual(kpiActualResponseSchema.parse(response), response);
  assert.equal(
    kpiActualResponseSchema.safeParse({
      ...response,
      monthly: response.monthly.slice(0, 2),
    }).success,
    false,
  );
  assert.equal(
    kpiActualResponseSchema.safeParse({
      ...response,
      totals: { ...response.totals, agencyRevenue: "0.1" },
    }).success,
    false,
  );
});
