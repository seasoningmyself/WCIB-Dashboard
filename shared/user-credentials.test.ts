import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createUserCredentialsSchema,
  userEmailSchema,
} from "./user-credentials.js";

test("userEmailSchema normalizes the email credential", () => {
  assert.equal(
    userEmailSchema.parse("  Person@Example.COM "),
    "person@example.com",
  );
});

test("createUserCredentialsSchema applies the shared password policy", () => {
  assert.equal(
    createUserCredentialsSchema.safeParse({
      email: "person@example.com",
      password: "weak",
    }).success,
    false,
  );
  assert.equal(
    createUserCredentialsSchema.safeParse({
      email: "person@example.com",
      password: "StrongPass123!",
    }).success,
    true,
  );
});
