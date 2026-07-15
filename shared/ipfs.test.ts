import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
