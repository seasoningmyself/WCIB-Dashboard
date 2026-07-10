import assert from "node:assert/strict";
import { test } from "node:test";
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from "./password-reset.js";

test("password reset request normalizes email and rejects extra fields", () => {
  assert.deepEqual(
    passwordResetRequestSchema.parse({ email: " USER@Example.COM " }),
    { email: "user@example.com" },
  );
  assert.equal(
    passwordResetRequestSchema.safeParse({
      email: "user@example.com",
      organizationId: "foreign-domain-field",
    }).success,
    false,
  );
});

test("password reset confirmation requires a token and full password policy", () => {
  const token = "a".repeat(43);
  assert.equal(
    passwordResetConfirmSchema.safeParse({
      password: "StrongPass123!",
      token,
    }).success,
    true,
  );
  assert.equal(
    passwordResetConfirmSchema.safeParse({
      password: "weak",
      token,
    }).success,
    false,
  );
  assert.equal(
    passwordResetConfirmSchema.safeParse({
      password: "StrongPass123!",
      token: "not-a-valid-token",
    }).success,
    false,
  );
});
