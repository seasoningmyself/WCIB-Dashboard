import assert from "node:assert/strict";
import { test } from "node:test";
import { loginRequestSchema } from "./login.js";

test("login request normalization preserves the password verbatim", () => {
  assert.deepEqual(
    loginRequestSchema.parse({
      email: "  USER@Example.COM ",
      password: "  exact password  ",
    }),
    {
      email: "user@example.com",
      password: "  exact password  ",
    },
  );
});

test("login requests reject empty, oversized, and extra fields", () => {
  assert.equal(
    loginRequestSchema.safeParse({
      email: "user@example.com",
      password: "",
    }).success,
    false,
  );
  assert.equal(
    loginRequestSchema.safeParse({
      email: "user@example.com",
      password: "x".repeat(1_025),
    }).success,
    false,
  );
  assert.equal(
    loginRequestSchema.safeParse({
      email: "user@example.com",
      organizationId: "dumpster-domain-field",
      password: "StrongPass123!",
    }).success,
    false,
  );
});
