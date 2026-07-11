import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSignedOutRoute,
  sanitizedResetUrl,
} from "./signed-out-route.js";

const TOKEN = "a".repeat(43);

test("signed-out routing recognizes request and confirmation links", () => {
  assert.deepEqual(parseSignedOutRoute("#/reset-password", ""), {
    type: "reset_request",
  });
  assert.deepEqual(
    parseSignedOutRoute(
      `#/reset-password/confirm?token=${TOKEN}`,
      "",
    ),
    { token: TOKEN, type: "reset_confirm" },
  );
  assert.deepEqual(
    parseSignedOutRoute("#/reset-password/confirm", `?token=${TOKEN}`),
    { token: TOKEN, type: "reset_confirm" },
  );
  assert.deepEqual(parseSignedOutRoute("#/pay-sheets", ""), {
    type: "login",
  });
});

test("reset URL sanitization removes only the secret token", () => {
  const sanitized = sanitizedResetUrl(
    "/dashboard",
    `?source=email&token=${TOKEN}`,
  );

  assert.equal(
    sanitized,
    "/dashboard?source=email#/reset-password/confirm",
  );
  assert.equal(sanitized.includes(TOKEN), false);
});
