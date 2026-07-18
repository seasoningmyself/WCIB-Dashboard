import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { AdminStaffApiError, createAdminStaffApi } from "./api.js";
import { staffFixture, uuid } from "./test-fixture.js";

const RATE = {
  effectiveDate: "2026-07-01",
  newBrokerRate: "20.00",
  newCommissionRate: "25.00",
  renewalBrokerRate: "30.00",
  renewalCommissionRate: "35.00",
} as const;

test("Manage Staff API uses only the guarded staff and append-only rate routes", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const staff = staffFixture();
  const responses = [
    Response.json({ items: [staff] }),
    Response.json({ staff }, { status: 201 }),
    Response.json({ staff }),
    Response.json({ staff }),
    Response.json({ staff }),
    Response.json({ staff }, { status: 201 }),
    Response.json({ staff }),
  ];
  const api = createAdminStaffApi({
    async request(path, options) {
      calls.push({ options, path });
      return responses.shift() ?? Response.json({});
    },
  });

  await api.list();
  await api.create({
    displayName: "New Producer",
    email: "new.producer@example.test",
    initialRate: RATE,
    role: "producer",
    temporaryPassword: "ValidPassword1!",
  });
  await api.update(staff.userId, { displayName: "Updated Producer" });
  await api.setActive(staff.userId, false);
  await api.setActive(staff.userId, true);
  await api.createRate(staff.userId, RATE);
  await api.updateRate(staff.userId, uuid(12), RATE);

  assert.deepEqual(
    calls.map(({ options, path }) => [options?.method, path]),
    [
      ["GET", "/admin/staff"],
      ["POST", "/admin/staff"],
      ["PATCH", `/admin/staff/${staff.userId}`],
      ["POST", `/admin/staff/${staff.userId}/deactivate`],
      ["POST", `/admin/staff/${staff.userId}/reactivate`],
      ["POST", `/admin/staff/${staff.userId}/rates`],
      ["PATCH", `/admin/staff/${staff.userId}/rates/${uuid(12)}`],
    ],
  );
  assert.deepEqual(JSON.parse(String(calls[1]?.options?.body)), {
    displayName: "New Producer",
    email: "new.producer@example.test",
    initialRate: RATE,
    role: "producer",
    temporaryPassword: "ValidPassword1!",
  });
  assert.equal(calls.some(({ options }) => options?.method === "DELETE"), false);
});

test("Manage Staff API rejects unsafe input before issuing a request", async () => {
  let requests = 0;
  const api = createAdminStaffApi({
    async request() {
      requests += 1;
      return Response.json({});
    },
  });
  await assert.rejects(
    api.create({
      displayName: "Unsafe",
      email: "unsafe@example.test",
      role: "employee",
      temporaryPassword: "short",
    }),
    isKind("rejected"),
  );
  await assert.rejects(
    api.update("not-a-uuid", { role: "producer" }),
    isKind("rejected"),
  );
  await assert.rejects(
    api.createRate(uuid(1), { ...RATE, newCommissionRate: "101.00" }),
    isKind("rejected"),
  );
  assert.equal(requests, 0);
});

test("Manage Staff API normalizes denial, conflict, rejection, network, and unsafe responses", async () => {
  for (const [response, kind] of [
    [new Response(null, { status: 403 }), "denied"],
    [new Response(null, { status: 409 }), "conflict"],
    [new Response(null, { status: 400 }), "rejected"],
    [new Response(null, { status: 500 }), "unavailable"],
    [Response.json({ items: [{ passwordHash: "forbidden" }] }), "invalid_response"],
  ] as const) {
    await assert.rejects(createAdminStaffApi(client(response)).list(), isKind(kind));
  }
  const unavailable = createAdminStaffApi({
    async request() {
      throw new Error("private network detail");
    },
  });
  await assert.rejects(unavailable.list(), isKind("unavailable"));
});

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}

function isKind(kind: AdminStaffApiError["kind"]) {
  return (error: unknown) =>
    error instanceof AdminStaffApiError && error.kind === kind;
}
