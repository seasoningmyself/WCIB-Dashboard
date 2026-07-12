import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { createMyItemsApi, MyItemsApiError } from "./api.js";
import { myItem, uuid } from "./test-fixture.js";

test("My Items API uses only the fixed status-safe endpoint", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const api = createMyItemsApi({
    async request(path, options) {
      calls.push({ options, path });
      return Response.json({ items: [myItem()] });
    },
  });

  const response = await api.list();
  assert.equal(response.items.length, 1);
  assert.deepEqual(calls, [
    {
      options: {
        cache: "no-store",
        headers: { Accept: "application/json" },
        method: "GET",
      },
      path: "/my-items",
    },
  ]);
  assert.equal(calls[0]?.path.includes("owner"), false);
  assert.equal(calls[0]?.path.includes(uuid(2)), false);
});

test("My Items API rejects a response containing any richer draft field", async () => {
  for (const field of [
    "basePremium",
    "commissionRate",
    "producerPayout",
    "financeReference",
    "ipfsFinanced",
    "ownerUserId",
    "policyNumber",
  ]) {
    const unsafe = { ...myItem(), [field]: `SENSITIVE_${field}` };
    const api = createMyItemsApi(client(Response.json({ items: [unsafe] })));
    await assert.rejects(api.list(), isApiError("invalid_response"));
  }
});

test("My Items API normalizes denied, network, and malformed responses", async () => {
  for (const [response, kind] of [
    [new Response(null, { status: 401 }), "denied"],
    [new Response(null, { status: 403 }), "denied"],
    [new Response(null, { status: 500 }), "unavailable"],
    [Response.json({ drafts: [] }), "invalid_response"],
  ] as const) {
    await assert.rejects(
      createMyItemsApi(client(response)).list(),
      isApiError(kind),
    );
  }
  const unavailable = createMyItemsApi({
    async request() {
      throw new Error("private network detail");
    },
  });
  await assert.rejects(unavailable.list(), isApiError("unavailable"));
});

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}

function isApiError(kind: MyItemsApiError["kind"]) {
  return (error: unknown) =>
    error instanceof MyItemsApiError && error.kind === kind;
}
