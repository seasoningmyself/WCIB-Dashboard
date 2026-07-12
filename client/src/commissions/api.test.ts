import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import {
  createMyCommissionsApi,
  MyCommissionsApiError,
} from "./api.js";
import { commissionItem, commissionsResponse, uuid } from "./test-fixture.js";

test("My Commissions API uses only producer-own read and receipt endpoints", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const api = createMyCommissionsApi({
    async request(path, options) {
      calls.push({ options, path });
      return calls.length === 1
        ? Response.json(commissionsResponse())
        : Response.json(commissionItem({ receivedAt: "2026-07-11T12:00:00.000Z", section: "paid", status: "received" }));
    },
  });

  await api.list({ search: " Acme & Sons ", sort: "account" });
  await api.setReceipt(uuid(1), { received: true });

  assert.equal(
    calls[0]?.path,
    "/my-commissions?search=Acme+%26+Sons&sort=account",
  );
  assert.equal(calls[0]?.options?.method, "GET");
  assert.equal(calls[0]?.options?.cache, "no-store");
  assert.equal(calls[1]?.path, `/my-commissions/${uuid(1)}/receipt`);
  assert.equal(calls[1]?.options?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[1]?.options?.body)), {
    received: true,
  });
  assert.equal(
    calls.some(({ path }) => /producer|rate|pay-sheet/i.test(path)),
    false,
  );
});

test("My Commissions API rejects unsafe input before issuing a request", async () => {
  let requests = 0;
  const api = createMyCommissionsApi({
    async request() {
      requests += 1;
      return Response.json({});
    },
  });

  await assert.rejects(
    api.list({ search: "", sort: "payout" } as never),
    isApiError("rejected"),
  );
  await assert.rejects(
    api.setReceipt("not-a-policy-id", { received: true }),
    isApiError("rejected"),
  );
  await assert.rejects(
    api.setReceipt(uuid(1), { received: true, producerId: uuid(2) } as never),
    isApiError("rejected"),
  );
  assert.equal(requests, 0);
});

test("My Commissions API rejects any response outside the exact payout allowlist", async () => {
  const unsafe = commissionsResponse();
  unsafe.items = [
    {
      ...commissionItem(),
      basePremium: "SENSITIVE_PREMIUM",
    } as never,
  ];
  const api = createMyCommissionsApi(client(Response.json(unsafe)));

  await assert.rejects(api.list({ search: "", sort: "insured" }), isApiError("invalid_response"));
});

test("My Commissions API normalizes denied, conflict, rejected, network, and response failures", async () => {
  for (const [response, kind] of [
    [new Response(null, { status: 403 }), "denied"],
    [new Response(null, { status: 404 }), "conflict"],
    [new Response(null, { status: 409 }), "conflict"],
    [new Response(null, { status: 400 }), "rejected"],
    [new Response(null, { status: 500 }), "unavailable"],
    [Response.json({ items: [] }), "invalid_response"],
  ] as const) {
    const api = createMyCommissionsApi(client(response));
    await assert.rejects(
      api.list({ search: "", sort: "insured" }),
      isApiError(kind),
    );
  }

  const unavailable = createMyCommissionsApi({
    async request() {
      throw new Error("network details stay local");
    },
  });
  await assert.rejects(
    unavailable.list({ search: "", sort: "insured" }),
    isApiError("unavailable"),
  );
});

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}

function isApiError(kind: MyCommissionsApiError["kind"]) {
  return (error: unknown) =>
    error instanceof MyCommissionsApiError && error.kind === kind;
}
