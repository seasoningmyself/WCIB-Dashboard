import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import {
  AdminVocabularyApiError,
  createAdminVocabularyApi,
} from "./admin-api.js";

const ID = "00000000-0000-4000-8000-000000000001";
const RESPONSE = {
  carriers: [{ id: ID, inUse: false, isActive: true, name: "Travelers" }],
  mgas: [],
  policyTypes: [
    {
      classTag: "Commercial",
      id: ID,
      inUse: true,
      isActive: true,
      name: "General Liability",
    },
  ],
} as const;

test("admin vocabulary API uses only the guarded management routes", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const client: ApiClient = {
    async request(path, options) {
      calls.push({ options, path });
      return Response.json(RESPONSE);
    },
  };
  const api = createAdminVocabularyApi(client);

  assert.deepEqual(await api.list(), RESPONSE);
  assert.deepEqual(await api.setActive("carrier", ID, { active: false }), RESPONSE);
  assert.deepEqual(
    calls.map(({ options, path }) => `${options?.method} ${path}`),
    [
      "GET /admin/vocabulary",
      `PUT /admin/vocabulary/carrier/${ID}/state`,
    ],
  );
  assert.equal(calls[1]?.options?.body, JSON.stringify({ active: false }));
});

test("admin vocabulary API fails closed on denial, conflict, and unsafe data", async () => {
  for (const [status, kind] of [
    [403, "denied"],
    [409, "conflict"],
    [500, "unavailable"],
  ] as const) {
    const api = createAdminVocabularyApi({
      async request() { return new Response(null, { status }); },
    });
    await assert.rejects(api.list(), (error: unknown) =>
      error instanceof AdminVocabularyApiError && error.kind === kind,
    );
  }

  const unsafe = createAdminVocabularyApi({
    async request() {
      return Response.json({ ...RESPONSE, agencyTotal: "1000.00" });
    },
  });
  await assert.rejects(unsafe.list(), (error: unknown) =>
    error instanceof AdminVocabularyApiError &&
      error.kind === "invalid_response",
  );
});
