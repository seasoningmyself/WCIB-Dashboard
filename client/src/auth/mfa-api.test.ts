import assert from "node:assert/strict";
import { test } from "node:test";
import { createMfaApi } from "./mfa-api.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const METHOD_ID = "00000000-0000-4000-8000-000000000002";
const CHALLENGE_ID = "00000000-0000-4000-8000-000000000003";
const TARGET_USER_ID = "00000000-0000-4000-8000-000000000004";

test("MFA client joins the API base URL exactly once", async () => {
  const requests: Array<{ init?: RequestInit; input: string }> = [];
  const api = createMfaApi(async (input, init) => {
    requests.push({ init, input: String(input) });
    return Response.json({
      expiresAt: "2026-07-21T15:30:00.000Z",
      methodId: METHOD_ID,
      otpauthUrl: "otpauth://totp/WCIB%3Aqa%40example.test?secret=ABCDEFGHIJKLMNOP",
      secret: "ABCDEFGHIJKLMNOP",
    });
  }, "/api");

  await api.startTotpEnrollment("Work phone");

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/mfa/enrollment/totp/start");
  assert.equal(requests[0]?.init?.credentials, "same-origin");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    label: "Work phone",
  });
});

test("MFA login and step-up requests use their registered routes", async () => {
  const requests: Array<{ init?: RequestInit; input: string }> = [];
  const api = createMfaApi(async (input, init) => {
    const path = String(input);
    requests.push({ init, input: path });
    if (path.endsWith("/auth/step-up/totp")) {
      return Response.json({
        expiresAt: "2026-07-21T15:30:00.000Z",
        token: "s".repeat(43),
      });
    }
    return Response.json({ userId: USER_ID });
  }, "/api");

  await api.loginWithTotp("123456");
  await api.loginWithRecoveryCode("recovery-code-with-enough-entropy");
  await api.stepUpWithTotp("Current password", "654321", {
    action: "admin_capability_change",
    mutation: { enabled: true },
    targetUserId: TARGET_USER_ID,
  });

  assert.deepEqual(
    requests.map(({ input }) => input),
    [
      "/api/auth/mfa/totp",
      "/api/auth/mfa/recovery",
      "/api/auth/step-up/totp",
    ],
  );
  for (const request of requests) {
    assert.equal(request.init?.credentials, "same-origin");
    assert.equal(request.init?.method, "POST");
  }
});

test("MFA WebAuthn request paths match the route registrar", async () => {
  const requests: string[] = [];
  const optionsResponse = {
    challengeId: CHALLENGE_ID,
    expiresAt: "2026-07-21T15:30:00.000Z",
    options: { challenge: "challenge" },
  };
  const api = createMfaApi(async (input) => {
    const path = String(input);
    requests.push(path);
    if (path.endsWith("/verify")) {
      if (path.includes("step-up")) {
        return Response.json({
          expiresAt: "2026-07-21T15:30:00.000Z",
          token: "w".repeat(43),
        });
      }
      if (path.includes("enrollment")) {
        return Response.json({
          mfa: {
            adminEnforcementEnabled: false,
            adminRecommended: true,
            enrolled: true,
            enrollmentRequired: false,
            policyRequired: false,
            methods: [],
            recoveryCodesAcknowledged: true,
            recoveryCodesRemaining: 10,
          },
        });
      }
      return Response.json({ userId: USER_ID });
    }
    return Response.json(optionsResponse);
  }, "/api");
  const descriptor = {
    action: "mfa_disable" as const,
    mutation: { disabled: true },
    targetUserId: TARGET_USER_ID,
  };

  await api.startPasskeyEnrollment();
  await api.confirmPasskeyEnrollment(
    CHALLENGE_ID,
    { id: "credential" } as never,
    "Personal YubiKey",
  );
  await api.startPasskeyLogin();
  await api.finishPasskeyLogin(CHALLENGE_ID, { id: "credential" } as never);
  await api.startPasskeyStepUp("Current password", descriptor);
  await api.finishPasskeyStepUp(
    CHALLENGE_ID,
    { id: "credential" } as never,
    descriptor,
  );

  assert.deepEqual(requests, [
    "/api/mfa/enrollment/passkey/options",
    "/api/mfa/enrollment/passkey/verify",
    "/api/auth/mfa/passkey/options",
    "/api/auth/mfa/passkey/verify",
    "/api/auth/step-up/passkey/options",
    "/api/auth/step-up/passkey/verify",
  ]);
});

test("MFA method management sends nicknames and exact-bound removal tokens", async () => {
  const requests: Array<{ init?: RequestInit; input: string }> = [];
  const api = createMfaApi(async (input, init) => {
    requests.push({ init, input: String(input) });
    return Response.json({
      mfa: {
        adminEnforcementEnabled: false,
        adminRecommended: false,
        enrolled: true,
        enrollmentRequired: false,
        policyRequired: false,
        methods: [],
        recoveryCodesAcknowledged: true,
        recoveryCodesRemaining: 10,
      },
    });
  }, "/api");

  await api.renameMethod(METHOD_ID, "Backup YubiKey");
  await api.removeMethod(METHOD_ID, "step-up-token");

  assert.deepEqual(
    requests.map(({ input }) => input),
    [
      `/api/mfa/methods/${METHOD_ID}`,
      `/api/mfa/methods/${METHOD_ID}`,
    ],
  );
  assert.equal(requests[0]?.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    label: "Backup YubiKey",
  });
  assert.equal(requests[1]?.init?.method, "DELETE");
  assert.equal(
    (requests[1]?.init?.headers as Record<string, string>)["X-WCIB-Step-Up"],
    "step-up-token",
  );
});
