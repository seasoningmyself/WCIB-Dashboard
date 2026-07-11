import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { loadActiveVocabulary, VocabularyApiError } from "./api.js";

const ID = "00000000-0000-4000-8000-000000000001";

test("vocabulary API loads the safe contract and ignores unknown response fields", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const client: ApiClient = {
    async request(path, options) {
      calls.push({ options, path });
      return Response.json({
        carriers: [
          { id: ID, inactiveHistory: ["private"], name: "Travelers" },
        ],
        financialTotal: "100000.00",
        mgas: [{ id: ID, name: "RPS", policyCount: 40 }],
        officeLocations: [],
        policyTypes: [
          {
            classTag: "Commercial",
            id: ID,
            name: "General Liability",
            premiumTotal: "9000.00",
          },
        ],
      });
    },
  };

  assert.deepEqual(await loadActiveVocabulary(client), {
    carriers: [{ id: ID, name: "Travelers" }],
    mgas: [{ id: ID, name: "RPS" }],
    officeLocations: [],
    policyTypes: [
      { classTag: "Commercial", id: ID, name: "General Liability" },
    ],
  });
  assert.equal(calls[0]?.path, "/vocabulary");
  assert.equal(calls[0]?.options?.cache, "no-store");
  assert.equal(calls[0]?.options?.method, "GET");
});

test("vocabulary API turns network, status, JSON, and contract failures into one safe error", async () => {
  const clients: ApiClient[] = [
    { async request() { throw new Error("private network detail"); } },
    { async request() { return new Response(null, { status: 500 }); } },
    {
      async request() {
        return new Response("not-json", {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
    {
      async request() {
        return Response.json({
          carriers: [{ id: "not-a-uuid", name: "Carrier" }],
          mgas: [],
          officeLocations: [],
          policyTypes: [],
        });
      },
    },
  ];

  for (const client of clients) {
    await assert.rejects(loadActiveVocabulary(client), VocabularyApiError);
  }
});
