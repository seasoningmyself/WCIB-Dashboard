import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import {
  createMgaPayablesApi,
  MgaPayablesApiError,
} from "./api.js";
import {
  payableItemFixture,
  payablesFixture,
  uuid,
} from "./test-fixture.js";

test("MGA payables API uses only the read and atomic state endpoints", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const paidItem = payableItemFixture({
    paidAt: "2026-07-11T12:00:00.000Z",
    paymentReference: "WIRE-123",
    status: "paid",
  });
  const responses = [
    Response.json(payablesFixture()),
    Response.json({
      item: paidItem,
      placement: { associationCount: 2, paySheetIds: [uuid(20), uuid(21)] },
    }),
    Response.json({
      changedCount: 1,
      results: [
        {
          item: paidItem,
          placement: {
            associationCount: 2,
            paySheetIds: [uuid(20), uuid(21)],
          },
        },
      ],
      status: "paid",
    }),
  ];
  const api = createMgaPayablesApi({
    async request(path, options) {
      calls.push({ options, path });
      return responses.shift() ?? Response.json({});
    },
  });

  await api.list("unpaid");
  await api.change(uuid(10), {
    reference: "  WIRE-123  ",
    status: "paid",
  });
  await api.changeGroup(uuid(1), { status: "paid" });

  assert.equal(calls[0]?.path, "/mga-payables?status=unpaid");
  assert.equal(calls[0]?.options?.method, "GET");
  assert.equal(calls[1]?.path, `/mga-payables/${uuid(10)}/state`);
  assert.equal(calls[1]?.options?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[1]?.options?.body)), {
    reference: "WIRE-123",
    status: "paid",
  });
  assert.equal(calls[2]?.path, `/mga-payables/groups/${uuid(1)}/state`);
  assert.equal(calls[2]?.options?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[2]?.options?.body)), {
    status: "paid",
  });
  assert.equal(
    calls.some(({ path }) => path.includes("placement")),
    false,
  );
});

test("MGA payables API rejects unsafe input before issuing a request", async () => {
  let requests = 0;
  const api = createMgaPayablesApi({
    async request() {
      requests += 1;
      return Response.json({});
    },
  });
  await assert.rejects(
    api.list("settled" as never),
    (error: unknown) =>
      error instanceof MgaPayablesApiError && error.kind === "rejected",
  );
  await assert.rejects(
    api.changeGroup(uuid(1), {
      reference: "not-accepted-for-groups",
      status: "paid",
    } as never),
    (error: unknown) =>
      error instanceof MgaPayablesApiError && error.kind === "rejected",
  );
  await assert.rejects(
    api.change(uuid(10), {
      reference: "not-allowed",
      status: "unpaid",
    } as never),
    (error: unknown) =>
      error instanceof MgaPayablesApiError && error.kind === "rejected",
  );
  assert.equal(requests, 0);
});

test("MGA payables API normalizes denied, conflict, rejected, network, and response failures", async () => {
  for (const [response, kind] of [
    [new Response(null, { status: 403 }), "denied"],
    [new Response(null, { status: 409 }), "conflict"],
    [new Response(null, { status: 400 }), "rejected"],
    [new Response(null, { status: 500 }), "unavailable"],
    [Response.json({ groups: [] }), "invalid_response"],
  ] as const) {
    const api = createMgaPayablesApi(client(response));
    await assert.rejects(
      api.list("all"),
      (error: unknown) =>
        error instanceof MgaPayablesApiError && error.kind === kind,
    );
  }
  const unavailable = createMgaPayablesApi({
    async request() {
      throw new Error("network details remain local");
    },
  });
  await assert.rejects(
    unavailable.list("paid"),
    (error: unknown) =>
      error instanceof MgaPayablesApiError && error.kind === "unavailable",
  );
});

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}
