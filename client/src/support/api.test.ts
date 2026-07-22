import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient } from "../api/client.js";
import { createSupportApi, SupportApiError } from "./api.js";

const TARGET_ID = "00000000-0000-4000-8000-000000000002";

test("support API uses only dedicated support routes and binds reset proof", async () => {
  const requests: Array<{ init?: RequestInit; path: string }> = [];
  const client: ApiClient = {
    async request(path, init) {
      requests.push({ init, path });
      if (path === "/support/accounts") {
        return Response.json({
          items: [{
            displayName: "Sophia",
            email: "sophia@example.test",
            id: TARGET_ID,
            mfaEnrolled: true,
            mfaEnrollmentRequired: false,
          }],
        });
      }
      return new Response(null, { status: 204 });
    },
  };
  const api = createSupportApi(client);

  const accounts = await api.listAccounts();
  await api.resetMfa(TARGET_ID, "Lost security key", "proof-token");

  assert.equal(accounts[0]?.displayName, "Sophia");
  assert.deepEqual(requests.map(({ path }) => path), [
    "/support/accounts",
    `/support/accounts/${TARGET_ID}/mfa-reset`,
  ]);
  assert.equal(new Headers(requests[1]?.init?.headers).get("X-WCIB-Step-Up"), "proof-token");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    reason: "Lost security key",
  });
});

test("support API rejects financial or credential fields in account targets", async () => {
  const api = createSupportApi({
    async request() {
      return Response.json({
        items: [{
          commissionRate: "50.00",
          displayName: "Producer",
          email: "producer@example.test",
          id: TARGET_ID,
          mfaEnrolled: true,
          mfaEnrollmentRequired: false,
        }],
      });
    },
  });

  await assert.rejects(
    api.listAccounts(),
    (error) => error instanceof SupportApiError && error.kind === "invalid_response",
  );
});
