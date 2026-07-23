import assert from "node:assert/strict";
import { test } from "node:test";
import { isPasswordPolicySatisfied } from "../../../shared/password-policy.js";
import { generateTemporaryPassphrase } from "./temporary-password.js";

test("temporary passphrases are readable, editable policy-compliant defaults", () => {
  const indexes = [0, 1, 2, 32];
  let position = 0;
  const generated = generateTemporaryPassphrase((upperBound) => {
    const value = indexes[position] ?? 0;
    position += 1;
    return value % upperBound;
  });

  assert.equal(generated, "Harbor-Cedar-Horizon-42");
  assert.equal(isPasswordPolicySatisfied(generated), true);
  assert.doesNotMatch(generated, /\s/);
  assert.doesNotMatch(generated, /west.?coast/i);
});
