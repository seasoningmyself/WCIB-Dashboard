import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TOKEN_BYTES,
} from "./password-reset.js";
import {
  PasswordResetDeliveryUnavailableError,
  unavailablePasswordResetDelivery,
} from "./password-reset-delivery.js";

test("password reset tokens use 32 random bytes and URL-safe encoding", () => {
  let requestedBytes = 0;
  const token = createPasswordResetToken((size) => {
    requestedBytes = size;
    return Buffer.alloc(size, 1);
  });

  assert.equal(requestedBytes, PASSWORD_RESET_TOKEN_BYTES);
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test("password reset tokens are hashed with SHA-256", () => {
  const token = "a".repeat(43);

  assert.equal(
    hashPasswordResetToken(token),
    createHash("sha256").update(token).digest("hex"),
  );
  assert.equal(hashPasswordResetToken(token).length, 64);
});

test("unconfigured delivery fails without exposing the reset token", async () => {
  const token = "private-reset-token";

  await assert.rejects(
    unavailablePasswordResetDelivery.send({
      email: "user@example.test",
      expiresAt: new Date("2026-07-09T01:00:00.000Z"),
      token,
    }),
    PasswordResetDeliveryUnavailableError,
  );
  try {
    await unavailablePasswordResetDelivery.send({
      email: "user@example.test",
      expiresAt: new Date("2026-07-09T01:00:00.000Z"),
      token,
    });
  } catch (error) {
    assert.equal(String(error).includes(token), false);
  }
});
