import assert from "node:assert/strict";
import { test } from "node:test";
import { REDACTED_LOG_VALUE, redactLogValue } from "./redact.js";

test("redactLogValue removes nested credentials, PII, and financial fields", () => {
  const result = redactLogValue({
    apiKey: "private-api-key",
    authorization: "Bearer private-token",
    DATABASE_URL: "postgresql://wcib:private-password@db/wcib",
    policy: {
      collectedToDate: 900,
      premiumTotal: 1_000,
      status: "approved",
    },
    statusCode: 200,
    user: {
      email: "person@example.com",
      fullName: "Private Person",
      phone: "312-555-0100",
    },
  });

  assert.deepEqual(result, {
    apiKey: REDACTED_LOG_VALUE,
    authorization: REDACTED_LOG_VALUE,
    DATABASE_URL: REDACTED_LOG_VALUE,
    policy: {
      collectedToDate: REDACTED_LOG_VALUE,
      premiumTotal: REDACTED_LOG_VALUE,
      status: "approved",
    },
    statusCode: 200,
    user: {
      email: REDACTED_LOG_VALUE,
      fullName: REDACTED_LOG_VALUE,
      phone: REDACTED_LOG_VALUE,
    },
  });
});

test("redactLogValue sanitizes secrets embedded in strings", () => {
  const result = String(
    redactLogValue(
      "postgresql://wcib:private-password@db/wcib Bearer token-value " +
        "person@example.com 312-555-0100",
    ),
  );

  assert.equal(result.includes("private-password"), false);
  assert.equal(result.includes("token-value"), false);
  assert.equal(result.includes("person@example.com"), false);
  assert.equal(result.includes("312-555-0100"), false);
  assert.match(result, /\[REDACTED\]/);
  assert.equal(
    redactLogValue("premium total was 1234"),
    REDACTED_LOG_VALUE,
  );
});

test("redactLogValue never serializes error messages or stacks", () => {
  const error = new TypeError("SESSION_SECRET=private-value");

  assert.deepEqual(redactLogValue(error), { name: "TypeError" });
  assert.equal(JSON.stringify(redactLogValue(error)).includes("private-value"), false);
});

test("redactLogValue bounds circular, deep, long, and large values", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const result = redactLogValue({
    circular,
    deep: { one: { two: { three: { four: { five: "hidden" } } } } },
    items: Array.from({ length: 25 }, (_, index) => index),
    long: "x".repeat(700),
  });
  const serialized = JSON.stringify(result);

  assert.match(serialized, /\[CIRCULAR\]/);
  assert.match(serialized, /\[TRUNCATED\]/);
  assert.ok(serialized.length < 1_200);
});
