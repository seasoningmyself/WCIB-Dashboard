import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthApiError,
  createAuthApi,
  PasswordResetApiError,
  type AuthFetch,
} from "./api.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const RESET_TOKEN = "a".repeat(43);

const loginResponse = {
  user: {
    capabilities: [],
    email: "producer@example.test",
    id: USER_ID,
    staffRole: "producer",
  },
};

const currentUserResponse = {
  user: {
    allowedNavigation: ["turn_in", "my_items", "my_commissions"],
    capabilities: [],
    displayName: "Kaylee",
    email: "producer@example.test",
    id: USER_ID,
    role: "producer",
  },
};

test("login establishes the Foundation session then trusts /api/me", async () => {
  const requests: Array<{ init?: RequestInit; input: string }> = [];
  const responses = [jsonResponse(loginResponse), jsonResponse(currentUserResponse)];
  const fetchRequest: AuthFetch = async (input, init) => {
    requests.push({ init, input: String(input) });
    const response = responses.shift();
    assert.ok(response);
    return response;
  };
  const api = createAuthApi(fetchRequest, "/api");

  const user = await api.login({
    email: "producer@example.test",
    password: "PrivatePass123!",
  });

  assert.deepEqual(user, currentUserResponse.user);
  assert.deepEqual(
    requests.map(({ input }) => input),
    ["/api/auth/login", "/api/me"],
  );
  assert.equal(requests[0]?.init?.credentials, "same-origin");
  assert.equal(requests[1]?.init?.credentials, "same-origin");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    email: "producer@example.test",
    password: "PrivatePass123!",
  });
  assert.equal(String(requests[0]?.init?.body).includes("role"), false);
  assert.equal(String(requests[0]?.init?.body).includes("capabilit"), false);
});

test("session restoration returns null only for an unauthenticated response", async () => {
  const unauthorized = createAuthApi(
    async () => jsonResponse({ error: { code: "unauthorized" } }, 401),
    "/api",
  );
  const authenticated = createAuthApi(
    async () => jsonResponse(currentUserResponse),
    "/api",
  );

  assert.equal(await unauthorized.restoreCurrentUser(), null);
  assert.deepEqual(
    await authenticated.restoreCurrentUser(),
    currentUserResponse.user,
  );
});

test("logout calls the idempotent Foundation endpoint once", async () => {
  const requests: Array<{ init?: RequestInit; input: string }> = [];
  const api = createAuthApi(async (input, init) => {
    requests.push({ init, input: String(input) });
    return new Response(null, { status: 204 });
  }, "/api");

  await api.logout();

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/auth/logout");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(requests[0]?.init?.credentials, "same-origin");
});

test("password-reset requests preserve the enumeration-safe contract", async () => {
  const requests: Array<{ init?: RequestInit; input: string }> = [];
  const api = createAuthApi(async (input, init) => {
    requests.push({ init, input: String(input) });
    return jsonResponse({ status: "accepted" }, 202);
  }, "/api");

  const existing = await api.requestPasswordReset({
    email: "existing@example.test",
  });
  const missing = await api.requestPasswordReset({
    email: "missing@example.test",
  });

  assert.equal(existing, undefined);
  assert.equal(missing, undefined);
  assert.deepEqual(
    requests.map(({ input }) => input),
    [
      "/api/auth/password-reset/request",
      "/api/auth/password-reset/request",
    ],
  );
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    email: "existing@example.test",
  });
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    email: "missing@example.test",
  });
});

test("password-reset confirmation sends only the token and new password", async () => {
  const requests: Array<{ init?: RequestInit; input: string }> = [];
  const api = createAuthApi(async (input, init) => {
    requests.push({ init, input: String(input) });
    return new Response(null, { status: 204 });
  }, "/api");

  await api.confirmPasswordReset({
    password: "StrongerPass123!",
    token: RESET_TOKEN,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/auth/password-reset/confirm");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    password: "StrongerPass123!",
    token: RESET_TOKEN,
  });
  assert.equal(requests[0]?.init?.credentials, "same-origin");
});

test("invalid reset tokens use one safe client error", async () => {
  let calls = 0;
  const api = createAuthApi(async () => {
    calls += 1;
    return jsonResponse(
      {
        error: {
          code: "invalid_reset_token",
          message: "private token lookup detail",
        },
      },
      400,
    );
  }, "/api");

  await assert.rejects(
    api.confirmPasswordReset({
      password: "StrongerPass123!",
      token: RESET_TOKEN,
    }),
    (error: unknown) =>
      error instanceof PasswordResetApiError &&
      error.kind === "invalid_token" &&
      !error.message.includes("private"),
  );
  await assert.rejects(
    api.confirmPasswordReset({
      password: "StrongerPass123!",
      token: "malformed",
    }),
    (error: unknown) =>
      error instanceof PasswordResetApiError &&
      error.kind === "validation",
  );
  assert.equal(calls, 1);
});

test("login separates credential, network, and invalid-contract failures", async () => {
  const invalidCredentials = createAuthApi(
    async () =>
      jsonResponse(
        {
          error: {
            code: "invalid_credentials",
            message: "private server detail must not propagate",
          },
        },
        401,
      ),
    "/api",
  );
  const unavailable = createAuthApi(async () => {
    throw new Error("password=must-not-propagate");
  }, "/api");
  const mismatched = createAuthApi(
    queuedFetch([
      jsonResponse(loginResponse),
      jsonResponse({
        user: {
          ...currentUserResponse.user,
          id: "00000000-0000-4000-8000-000000000002",
        },
      }),
    ]),
    "/api",
  );

  await assert.rejects(
    invalidCredentials.login({
      email: "user@example.test",
      password: "WrongPass123!",
    }),
    (error: unknown) =>
      error instanceof AuthApiError &&
      error.kind === "invalid_credentials" &&
      !error.message.includes("private"),
  );
  await assert.rejects(
    unavailable.restoreCurrentUser(),
    (error: unknown) =>
      error instanceof AuthApiError &&
      error.kind === "network" &&
      !error.message.includes("password"),
  );
  await assert.rejects(
    mismatched.login({
      email: "producer@example.test",
      password: "PrivatePass123!",
    }),
    (error: unknown) =>
      error instanceof AuthApiError && error.kind === "invalid_response",
  );
});

function queuedFetch(responses: Response[]): AuthFetch {
  return async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
