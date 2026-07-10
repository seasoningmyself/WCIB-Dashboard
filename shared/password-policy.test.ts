import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getPasswordRequirementStatuses,
  isPasswordPolicySatisfied,
  optionalPasswordSchema,
  passwordSchema,
} from "./password-policy.js";

function assertPasswordError(password: string, expectedMessage: string): void {
  const result = passwordSchema.safeParse(password);
  assert.equal(result.success, false);
  assert.ok(
    result.error.issues.some((issue) => issue.message === expectedMessage),
  );
}

test("password policy accepts passwords satisfying every requirement", () => {
  assert.equal(passwordSchema.safeParse("StrongPass123!").success, true);
  assert.equal(isPasswordPolicySatisfied("StrongPass123!"), true);
});

test("password policy rejects passwords shorter than 12 characters", () => {
  assertPasswordError("Short1!", "Password must be at least 12 characters");
});

test("password policy rejects passwords without uppercase letters", () => {
  assertPasswordError(
    "strongpass123!",
    "Password must contain at least one uppercase letter",
  );
});

test("password policy rejects passwords without lowercase letters", () => {
  assertPasswordError(
    "STRONGPASS123!",
    "Password must contain at least one lowercase letter",
  );
});

test("password policy rejects passwords without numbers", () => {
  assertPasswordError(
    "StrongPassword!",
    "Password must contain at least one number",
  );
});

test("password policy rejects passwords without special characters", () => {
  assertPasswordError(
    "StrongPass123",
    "Password must contain at least one special character",
  );
});

test("password policy reports requirement statuses", () => {
  const statuses = getPasswordRequirementStatuses("StrongPass123!");

  assert.deepEqual(
    statuses.map((status) => [status.id, status.isSatisfied]),
    [
      ["minLength", true],
      ["uppercase", true],
      ["lowercase", true],
      ["number", true],
      ["special", true],
    ],
  );
});

test("optional password policy validates only provided passwords", () => {
  assert.equal(optionalPasswordSchema.safeParse("").success, true);
  assert.equal(optionalPasswordSchema.safeParse(undefined).success, true);
  assert.equal(optionalPasswordSchema.safeParse("Weakpass123").success, false);
  assert.equal(
    optionalPasswordSchema.safeParse("StrongPass123!").success,
    true,
  );
});
