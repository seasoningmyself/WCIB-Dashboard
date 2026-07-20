import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { createSettingsApi, SettingsApiError } from "./api.js";

const SETTINGS = {
  displayName: "Kaylee",
  email: "kaylee@example.test",
  officeLocation: null,
};

test("Settings API uses UUID-free own-record routes and strict payloads", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const responses = [
    Response.json({ settings: SETTINGS }),
    Response.json({ settings: { ...SETTINGS, displayName: "Kaylee Updated" } }),
    new Response(null, { status: 204 }),
  ];
  const api = createSettingsApi({
    async request(path, options) {
      calls.push({ options, path });
      return responses.shift() ?? Response.json({});
    },
  });

  await api.load();
  await api.updateProfile({ displayName: "Kaylee Updated" });
  await api.changePassword({
    confirmation: "Blue harbor lantern 73!",
    currentPassword: "Initial temporary 2026!",
    newPassword: "Blue harbor lantern 73!",
  });

  assert.deepEqual(
    calls.map(({ options, path }) => [options?.method, path]),
    [
      ["GET", "/settings/me"],
      ["PATCH", "/settings/me/profile"],
      ["POST", "/settings/me/password"],
    ],
  );
  assert.deepEqual(JSON.parse(String(calls[1]?.options?.body)), {
    displayName: "Kaylee Updated",
  });
  assert.deepEqual(JSON.parse(String(calls[2]?.options?.body)), {
    confirmation: "Blue harbor lantern 73!",
    currentPassword: "Initial temporary 2026!",
    newPassword: "Blue harbor lantern 73!",
  });
  assert.equal(calls.some(({ path }) => /[0-9a-f]{8}-/.test(path)), false);
});

test("Settings API rejects identity, role, capability, email, and office injection", async () => {
  let requests = 0;
  const api = createSettingsApi({
    async request() {
      requests += 1;
      return Response.json({ settings: SETTINGS });
    },
  });
  const injected = {
    capabilities: ["admin"],
    displayName: "Injected",
    email: "other@example.test",
    officeLocationId: null,
    role: "admin",
    userId: "00000000-0000-4000-8000-000000000099",
  };

  await assert.rejects(
    api.updateProfile(injected),
    (error: unknown) =>
      error instanceof SettingsApiError && error.kind === "rejected",
  );
  await assert.rejects(
    api.changePassword({
      confirmation: "password1234",
      currentPassword: "Current password 2026!",
      newPassword: "password1234",
    }),
    (error: unknown) =>
      error instanceof SettingsApiError && error.kind === "rejected",
  );
  assert.equal(requests, 0);
});

test("Settings API normalizes denied, current-password, reuse, and unsafe responses", async () => {
  for (const [response, kind] of [
    [new Response(null, { status: 403 }), "denied"],
    [
      Response.json(
        { error: { code: "invalid_current_password" } },
        { status: 400 },
      ),
      "invalid_current_password",
    ],
    [
      Response.json({ error: { code: "password_reuse" } }, { status: 409 }),
      "reuse",
    ],
    [Response.json({ settings: { passwordHash: "forbidden" } }), "invalid_response"],
  ] as const) {
    const api = createSettingsApi(client(response));
    const operation =
      kind === "invalid_current_password" || kind === "reuse"
        ? api.changePassword({
            confirmation: "Blue harbor lantern 73!",
            currentPassword: "Initial temporary 2026!",
            newPassword: "Blue harbor lantern 73!",
          })
        : api.load();
    await assert.rejects(
      operation,
      (error: unknown) =>
        error instanceof SettingsApiError && error.kind === kind,
    );
  }
});

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}
