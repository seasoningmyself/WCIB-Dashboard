import assert from "node:assert/strict";
import { test } from "node:test";
import {
  kpiTargetListQuerySchema,
  kpiTargetListResponseSchema,
  kpiTargetMutationRequestSchema,
} from "./kpi-target-api.js";

const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";

test("KPI target requests enforce exact scope and bounded target values", () => {
  assert.deepEqual(
    kpiTargetListQuerySchema.parse({ year: "2026" }),
    { year: 2026 },
  );
  assert.deepEqual(
    kpiTargetListQuerySchema.parse({
      producerUserId: PRODUCER_ID,
      scopeType: "producer",
      year: "2026",
    }),
    { producerUserId: PRODUCER_ID, scopeType: "producer", year: 2026 },
  );
  for (const invalid of [
    { producerUserId: PRODUCER_ID, scopeType: "company", year: "2026" },
    { scopeType: "producer", year: "2026" },
    { producerUserId: PRODUCER_ID, year: "2026" },
    { year: "1999" },
  ]) assert.equal(kpiTargetListQuerySchema.safeParse(invalid).success, false);

  assert.deepEqual(
    kpiTargetMutationRequestSchema.parse({
      newPolicyCountTarget: null,
      producerUserId: null,
    }),
    { newPolicyCountTarget: null, producerUserId: null },
  );
  for (const invalid of [
    { producerUserId: null },
    { newPolicyCountTarget: -1, producerUserId: null },
    { newRevenueTarget: "1.1", producerUserId: null },
    { newRevenueTarget: "-0.01", producerUserId: null },
    { producerUserId: null, retentionRateTarget: "100.01" },
    { producerUserId: null, retentionRateTarget: 75 },
    { producerUserId: null, unexpected: "value" },
  ]) assert.equal(kpiTargetMutationRequestSchema.safeParse(invalid).success, false);
});

test("KPI target response exposes only stable scope and exact target fields", () => {
  const parsed = kpiTargetListResponseSchema.parse({
    items: [
      {
        newPolicyCountTarget: 12,
        newRevenueTarget: "150000.00",
        producerUserId: null,
        retentionRateTarget: "82.50",
        scopeType: "company",
        year: 2026,
      },
    ],
    producers: [
      {
        displayName: "Kaylee",
        isActive: true,
        producerUserId: PRODUCER_ID,
      },
    ],
    year: 2026,
  });
  assert.deepEqual(Object.keys(parsed.items[0]!).sort(), [
    "newPolicyCountTarget",
    "newRevenueTarget",
    "producerUserId",
    "retentionRateTarget",
    "scopeType",
    "year",
  ]);
  assert.equal(
    kpiTargetListResponseSchema.safeParse({
      ...parsed,
      internalId: "secret",
    }).success,
    false,
  );
});
