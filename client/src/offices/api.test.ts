import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { AdminOfficeApiError, createAdminOfficeApi } from "./api.js";

const OFFICE_ID = "00000000-0000-4000-8000-000000000001";
const RESPONSE = {
  items: [
    {
      createdAt: "2026-07-12T12:00:00.000Z",
      id: OFFICE_ID,
      isActive: true,
      name: "San Francisco",
      updatedAt: "2026-07-12T12:00:00.000Z",
    },
  ],
  mode: { activeCount: 1, kind: "single", soleOfficeId: OFFICE_ID },
} as const;

test("office API uses only the real management routes and authoritative responses", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const client: ApiClient = {
    async request(path, options) {
      calls.push({ options, path });
      return Response.json(RESPONSE, {
        status: options?.method === "POST" && path === "/admin/office-locations" ? 201 : 200,
      });
    },
  };
  const api = createAdminOfficeApi(client);

  assert.deepEqual(await api.list(), RESPONSE);
  assert.deepEqual(await api.create(" San Francisco "), RESPONSE);
  assert.deepEqual(await api.rename(OFFICE_ID, " San Francisco "), RESPONSE);
  assert.deepEqual(await api.setActive(OFFICE_ID, false), RESPONSE);
  assert.deepEqual(await api.setActive(OFFICE_ID, true), RESPONSE);

  assert.deepEqual(
    calls.map(({ options, path }) => `${options?.method} ${path}`),
    [
      "GET /admin/office-locations",
      "POST /admin/office-locations",
      `PATCH /admin/office-locations/${OFFICE_ID}`,
      `POST /admin/office-locations/${OFFICE_ID}/deactivate`,
      `POST /admin/office-locations/${OFFICE_ID}/reactivate`,
    ],
  );
  assert.equal(calls[0]?.options?.cache, "no-store");
  assert.equal(calls[1]?.options?.body, JSON.stringify({ name: "San Francisco" }));
});

test("office API rejects bad inputs, denied responses, conflicts, and unsafe payloads", async () => {
  const rejected = createAdminOfficeApi({
    async request() { throw new Error("must not run"); },
  });
  await assert.rejects(rejected.create("   "), (error: unknown) =>
    error instanceof AdminOfficeApiError && error.kind === "rejected",
  );

  for (const [status, kind] of [
    [403, "denied"],
    [409, "conflict"],
    [500, "unavailable"],
  ] as const) {
    const api = createAdminOfficeApi({
      async request() { return new Response(null, { status }); },
    });
    await assert.rejects(api.list(), (error: unknown) =>
      error instanceof AdminOfficeApiError && error.kind === kind,
    );
  }

  const unsafe = createAdminOfficeApi({
    async request() { return Response.json({ ...RESPONSE, financialTotal: "9000.00" }); },
  });
  await assert.rejects(unsafe.list(), (error: unknown) =>
    error instanceof AdminOfficeApiError && error.kind === "invalid_response",
  );
});
