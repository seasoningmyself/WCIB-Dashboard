import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ipfsPushedStateRequestSchema,
  ipfsPriorFinancingQuerySchema,
  ipfsPriorFinancingResponseSchema,
} from "./ipfs.js";

test("IPFS history contracts expose only the minimal prior-financing fact", () => {
  assert.deepEqual(
    ipfsPriorFinancingQuerySchema.parse({ insuredName: "  Acme LLC  " }),
    { insuredName: "Acme LLC" },
  );
  assert.deepEqual(
    ipfsPriorFinancingResponseSchema.parse({
      priorFinancing: { lastFinancedAt: new Date("2026-07-01T12:00:00.000Z") },
    }),
    { priorFinancing: { lastFinancedAt: "2026-07-01T12:00:00.000Z" } },
  );
  assert.equal(
    ipfsPriorFinancingResponseSchema.safeParse({
      priorFinancing: {
        lastFinancedAt: "2026-07-01T12:00:00.000Z",
        policyId: "00000000-0000-4000-8000-000000000001",
      },
    }).success,
    false,
  );
});

test("IPFS pushed-state requests are strict and versioned", () => {
  assert.deepEqual(
    ipfsPushedStateRequestSchema.parse({
      expectedUpdatedAt: new Date("2026-07-14T12:00:00.000Z"),
      pushed: true,
    }),
    {
      expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
      pushed: true,
    },
  );
  assert.equal(
    ipfsPushedStateRequestSchema.safeParse({
      actorUserId: "00000000-0000-4000-8000-000000000001",
      expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
      pushed: true,
    }).success,
    false,
  );
});
