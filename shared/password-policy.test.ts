import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getPasswordRequirementStatuses,
  isPasswordPolicySatisfied,
  PASSWORD_MAX_LENGTH,
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

test("password policy accepts long passphrases without composition rules", () => {
  assert.equal(passwordSchema.safeParse("four quiet words").success, true);
  assert.equal(isPasswordPolicySatisfied("all lowercase words are valid"), true);
  assert.equal(passwordSchema.parse("Cafe\u0301 secure phrase"), "Caf\u00e9 secure phrase");
});

test("password policy rejects passwords shorter than 12 characters", () => {
  assertPasswordError("Short1!", "Password must be at least 12 characters");
});

test("password policy rejects values over 128 Unicode characters", () => {
  assertPasswordError(
    "x".repeat(PASSWORD_MAX_LENGTH + 1),
    "Password must be 128 characters or fewer",
  );
  assert.equal(passwordSchema.safeParse("\ud83d\udd10".repeat(PASSWORD_MAX_LENGTH)).success, true);
});

test("password policy rejects common, compromised, and WCIB-predictable values", () => {
  for (const password of [
    "Password1234!",
    "correct horse battery staple",
    "Westcoastisthebest1!",
    "My WCIB dashboard password",
  ]) {
    assertPasswordError(password, "Password is too common or predictable");
  }
});

test("password policy reports requirement statuses", () => {
  const statuses = getPasswordRequirementStatuses("StrongPass123!");

  assert.deepEqual(
    statuses.map((status) => [status.id, status.isSatisfied]),
    [
      ["minLength", true],
      ["maxLength", true],
      ["blocklist", true],
    ],
  );
});

test("optional password policy validates only provided passwords", () => {
  assert.equal(optionalPasswordSchema.safeParse("").success, true);
  assert.equal(optionalPasswordSchema.safeParse(undefined).success, true);
  assert.equal(optionalPasswordSchema.safeParse("short").success, false);
  assert.equal(
    optionalPasswordSchema.safeParse("StrongPass123!").success,
    true,
  );
});
