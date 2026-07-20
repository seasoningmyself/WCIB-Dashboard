import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasThrottleDecayed,
  throttleCooldownForFailureCount,
} from "./login-throttle.js";

test("account and IP thresholds escalate temporarily and cap at fifteen minutes", () => {
  assert.equal(throttleCooldownForFailureCount("account", 4), null);
  assert.equal(throttleCooldownForFailureCount("account", 5), 60);
  assert.equal(throttleCooldownForFailureCount("account", 9), null);
  assert.equal(throttleCooldownForFailureCount("account", 10), 300);
  assert.equal(throttleCooldownForFailureCount("account", 14), null);
  assert.equal(throttleCooldownForFailureCount("account", 15), 900);
  assert.equal(throttleCooldownForFailureCount("account", 500), 900);

  assert.equal(throttleCooldownForFailureCount("ip", 19), null);
  assert.equal(throttleCooldownForFailureCount("ip", 20), 60);
  assert.equal(throttleCooldownForFailureCount("ip", 40), 300);
  assert.equal(throttleCooldownForFailureCount("ip", 60), 900);
  assert.equal(throttleCooldownForFailureCount("ip", 5_000), 900);
});

test("throttle state decays at twenty-four hours without permanent lockout", () => {
  const failedAt = new Date("2026-07-19T12:00:00.000Z");
  assert.equal(
    hasThrottleDecayed(
      failedAt,
      new Date("2026-07-20T11:59:59.999Z"),
    ),
    false,
  );
  assert.equal(
    hasThrottleDecayed(failedAt, new Date("2026-07-20T12:00:00.000Z")),
    true,
  );
});
