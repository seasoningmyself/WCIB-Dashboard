import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionBoundary } from "../auth/session-boundary.js";
import { createApiClient, type ApiFetch } from "./client.js";

test("protected 401 responses cause one deduplicated session transition", async () => {
  let transitions = 0;
  const boundary = createSessionBoundary(() => {
    transitions += 1;
  });
  boundary.beginSession();
  const client = createApiClient({
    baseUrl: "/api",
    fetchRequest: async () => new Response(null, { status: 401 }),
    onUnauthorized: () => {
      boundary.endSession("expired", "/policy-ledger");
    },
  });

  await Promise.all([
    client.request("/policies"),
    client.request("/pay-sheets"),
    client.request("/mga-payables"),
  ]);

  assert.equal(transitions, 1);
});

test("403 and public auth 401 responses do not become session expiry", async () => {
  let transitions = 0;
  const responses = [
    new Response(null, { status: 403 }),
    new Response(null, { status: 401 }),
  ];
  const client = createApiClient({
    baseUrl: "/api",
    fetchRequest: queuedFetch(responses),
    onUnauthorized: () => {
      transitions += 1;
    },
  });

  await client.request("/admin-only");
  await client.request("/auth/login", { access: "public", method: "POST" });

  assert.equal(transitions, 0);
});

test("API requests use same-origin cookies and reject external paths", async () => {
  const requests: Array<{ init?: RequestInit; input: string }> = [];
  const client = createApiClient({
    baseUrl: "/api",
    fetchRequest: async (input, init) => {
      requests.push({ init, input: String(input) });
      return new Response(null, { status: 204 });
    },
    onUnauthorized() {},
  });

  await client.request("/policies");
  assert.equal(requests[0]?.input, "/api/policies");
  assert.equal(requests[0]?.init?.credentials, "same-origin");
  await assert.rejects(
    client.request("https://outside.example"),
    /root-relative/,
  );
  await assert.rejects(
    client.request("//outside.example"),
    /root-relative/,
  );
});

function queuedFetch(responses: Response[]): ApiFetch {
  return async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  };
}
