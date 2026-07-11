import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError, createAuthApi, type AuthFetch } from "./api.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

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
    allowedNavigation: ["my_commissions"],
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
