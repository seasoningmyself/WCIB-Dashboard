import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { BusinessStateApiError, createBusinessStateApi } from "./api.js";

const GENERATION_ID = "00000000-0000-4000-8000-000000000001";
const GENERATION = {
  baselineChecksum: null,
  clearKpiTargets: false,
  code: "ABCDEF123456",
  createdAt: "2026-07-14T12:00:00.000Z",
  id: GENERATION_ID,
  logicalChecksum: null,
  migrationCount: 48,
  rowCounts: null,
  schemaFingerprint:
    "6a06ce086a9beb6b68f788f18afc03712019d56f56003401a9c796fec751991a",
  sealedAt: null,
  status: "active",
} as const;

test("business-state API uses only guarded list, reset, and restore routes", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const list = { activeGenerationId: GENERATION_ID, generations: [GENERATION] };
  const transition = { activeGeneration: GENERATION, sealedGeneration: { ...GENERATION, status: "sealed", logicalChecksum: "a".repeat(32), rowCounts: rowCounts(), sealedAt: "2026-07-14T13:00:00.000Z" } };
  const responses = [Response.json(list), Response.json(transition), Response.json(transition)];
  const api = createBusinessStateApi({
    async request(path, options) {
      calls.push({ options, path });
      return responses.shift() ?? Response.json({});
    },
  });

  assert.deepEqual(await api.list(), list);
  await api.reset({ clearKpiTargets: true, confirmation: "RESET" });
  await api.restore(GENERATION_ID, { confirmation: "RESTORE ABCDEF123456" });

  assert.deepEqual(
    calls.map(({ options, path }) => [options?.method, path]),
    [
      ["GET", "/admin/business-state"],
      ["POST", "/admin/business-state/reset"],
      ["POST", `/admin/business-state/generations/${GENERATION_ID}/restore`],
    ],
  );
  assert.equal(calls.every(({ options }) => options?.cache === "no-store"), true);
  assert.equal(calls[1]?.options?.body, JSON.stringify({ clearKpiTargets: true, confirmation: "RESET" }));
  assert.equal(calls[2]?.options?.body, JSON.stringify({ confirmation: "RESTORE ABCDEF123456" }));
});

test("business-state API rejects bad confirmation, denials, conflicts, and unsafe payloads", async () => {
  let calls = 0;
  const rejecting = createBusinessStateApi({ async request() { calls += 1; return Response.json({}); } });
  assert.throws(() =>
    rejecting.reset({ clearKpiTargets: false, confirmation: "reset" as "RESET" }),
  );
  assert.equal(calls, 0);

  for (const [status, kind] of [[403, "denied"], [409, "conflict"], [400, "rejected"], [500, "unavailable"]] as const) {
    const api = createBusinessStateApi(client(new Response(null, { status })));
    await assert.rejects(api.list(), (error: unknown) =>
      error instanceof BusinessStateApiError && error.kind === kind,
    );
  }
  const unsafe = createBusinessStateApi(client(Response.json({
    activeGenerationId: GENERATION_ID,
    generations: [{ ...GENERATION, policies: [{ netDue: "900.00" }] }],
  })));
  await assert.rejects(unsafe.list(), (error: unknown) =>
    error instanceof BusinessStateApiError && error.kind === "invalid_response",
  );
});

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}

function rowCounts() {
  return {
    approvalQueueEntries: 0, drafts: 0, kpiTargets: 0, mgaPayments: 0,
    paySheetAdjustments: 0, paySheetPolicies: 0, paySheets: 1, policies: 0,
    policyChangeRequests: 0, policyOverrides: 0,
  };
}
