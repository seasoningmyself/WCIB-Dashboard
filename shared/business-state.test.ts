import assert from "node:assert/strict";
import { test } from "node:test";
import {
  businessStateListResponseSchema,
  resetBusinessStateRequestSchema,
  restoreBusinessStateRequestSchema,
} from "./business-state.js";

test("business-state contracts require exact typed confirmation and bounded metadata", () => {
  assert.deepEqual(
    resetBusinessStateRequestSchema.parse({
      clearKpiTargets: false,
      confirmation: "RESET",
    }),
    { clearKpiTargets: false, confirmation: "RESET" },
  );
  for (const confirmation of ["reset", " RESET", "RESET ", "RESTORE"]) {
    assert.equal(
      resetBusinessStateRequestSchema.safeParse({ confirmation }).success,
      false,
    );
  }
  assert.equal(
    restoreBusinessStateRequestSchema.safeParse({ confirmation: "" }).success,
    false,
  );
  assert.equal(
    restoreBusinessStateRequestSchema.safeParse({
      confirmation: "RESTORE ABCDEF123456",
      rowContents: { insuredName: "must not be accepted" },
    }).success,
    false,
  );
});

test("business-state list response rejects row contents and financial fields", () => {
  const generation = {
    baselineChecksum: null,
    clearKpiTargets: false,
    code: "ABCDEF123456",
    createdAt: "2026-07-14T12:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    logicalChecksum: null,
    migrationCount: 48,
    rowCounts: null,
    schemaFingerprint:
      "6a06ce086a9beb6b68f788f18afc03712019d56f56003401a9c796fec751991a",
    sealedAt: null,
    status: "active",
  } as const;
  const valid = {
    activeGenerationId: generation.id,
    generations: [generation],
  };
  assert.deepEqual(businessStateListResponseSchema.parse(valid), valid);
  for (const unsafe of [
    { ...valid, databaseUrl: "secret" },
    { ...valid, policies: [{ premiumTotal: "1000.00" }] },
    {
      ...valid,
      generations: [{ ...generation, rowContents: [{ insuredName: "Private" }] }],
    },
  ]) {
    assert.equal(businessStateListResponseSchema.safeParse(unsafe).success, false);
  }
});
