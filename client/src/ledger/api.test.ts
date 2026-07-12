import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient } from "../api/client.js";
import {
  createPolicyLedgerApi,
  PolicyLedgerApiError,
} from "./api.js";
import {
  ledgerItemFixture,
  ledgerListFixture,
  uuid,
} from "./test-fixture.js";

test("policy ledger API uses the real list, detail, assignment, and correction paths", async () => {
  const calls: Array<{ options: RequestInit | undefined; path: string }> = [];
  const responses = [
    Response.json(ledgerListFixture()),
    Response.json({ item: ledgerItemFixture() }),
    Response.json({ producers: [{ displayName: "Kaylee", userId: uuid(5) }] }),
    Response.json({ policy: ledgerItemFixture().policy }),
  ];
  const api = createPolicyLedgerApi({
    async request(path, options) {
      calls.push({ options, path });
      return responses.shift() ?? Response.json({});
    },
  });

  await api.list({
    direction: "asc",
    duplicates: "only",
    finance: "ipfs_pending",
    limit: 50,
    month: "2026-07",
    offset: 100,
    search: "Acme & Sons",
    sort: "insured",
  });
  await api.get(uuid(10));
  await api.listAssignmentOptions();
  const kind = await api.correct(uuid(10), {
    change: {
      changedFields: ["insuredName"],
      reason: "Correct insured",
      replacementValues: { insuredName: "Corrected Insured" },
    },
    expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
    kind: "general",
  });
  assert.equal(kind, "general");
  assert.equal(
    calls[0]?.path,
    "/policies?duplicates=only&finance=ipfs_pending&limit=50&offset=100&search=Acme+%26+Sons&sort=insured&direction=asc&month=2026-07",
  );
  assert.equal(calls[0]?.options?.method, "GET");
  assert.equal(calls[1]?.path, `/policies/${uuid(10)}`);
  assert.equal(calls[2]?.path, "/draft-assignment-options");
  assert.equal(calls[3]?.path, `/policies/${uuid(10)}/correction`);
  assert.equal(calls[3]?.options?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[3]?.options?.body)), {
    change: {
      changedFields: ["insuredName"],
      reason: "Correct insured",
      replacementValues: { insuredName: "Corrected Insured" },
    },
    expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
    kind: "general",
  });
});

test("policy ledger API rejects invalid input before a request", async () => {
  let requests = 0;
  const api = createPolicyLedgerApi({
    async request() {
      requests += 1;
      return Response.json({});
    },
  });
  await assert.rejects(
    api.list({ limit: 500 }),
    (error: unknown) =>
      error instanceof PolicyLedgerApiError && error.kind === "rejected",
  );
  await assert.rejects(
    api.correct(uuid(10), {
      change: {
        changedFields: ["brokerFee"],
        reason: "Mixed path",
        replacementValues: { brokerFee: "20.00" },
      },
      expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
      kind: "general",
    } as never),
    (error: unknown) =>
      error instanceof PolicyLedgerApiError && error.kind === "rejected",
  );
  assert.equal(requests, 0);
});

test("policy ledger API normalizes denied, conflict, rejected, network, and response failures", async () => {
  for (const [response, kind] of [
    [new Response(null, { status: 403 }), "denied"],
    [new Response(null, { status: 409 }), "conflict"],
    [new Response(null, { status: 400 }), "rejected"],
    [new Response(null, { status: 500 }), "unavailable"],
    [Response.json({ items: [] }), "invalid_response"],
  ] as const) {
    const api = createPolicyLedgerApi(client(response));
    await assert.rejects(
      api.list({}),
      (error: unknown) =>
        error instanceof PolicyLedgerApiError && error.kind === kind,
    );
  }
  const unavailable = createPolicyLedgerApi({
    async request() {
      throw new Error("network details must remain local");
    },
  });
  await assert.rejects(
    unavailable.list({}),
    (error: unknown) =>
      error instanceof PolicyLedgerApiError && error.kind === "unavailable",
  );
});

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}
