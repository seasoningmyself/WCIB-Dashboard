import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient } from "../api/client.js";
import { createAccountSecurityApi } from "./account-security-api.js";

const TARGET_ID = "00000000-0000-4000-8000-000000000003";

test("Account Security binds support capability changes to the dedicated route", async () => {
  const requests: Array<{ init?: RequestInit; path: string }> = [];
  const client: ApiClient = {
    async request(path, init) {
      requests.push({ init, path });
      return new Response(null, { status: 204 });
    },
  };

  await createAccountSecurityApi(client).setSupportCapability(
    TARGET_ID,
    true,
    "step-up-proof",
  );

  assert.equal(
    requests[0]?.path,
    `/admin/account-security/${TARGET_ID}/support-capability`,
  );
  assert.equal(requests[0]?.init?.method, "PATCH");
  assert.equal(
    new Headers(requests[0]?.init?.headers).get("X-WCIB-Step-Up"),
    "step-up-proof",
  );
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    enabled: true,
  });
});
