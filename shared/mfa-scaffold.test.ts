import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOUNDATION_MFA_ENFORCEMENT_ENABLED,
  isMfaMethodType,
  MFA_METHOD_TYPES,
} from "./mfa-scaffold.js";

test("Foundation MFA vocabulary is explicit and enforcement is off", () => {
  assert.deepEqual(MFA_METHOD_TYPES, ["email", "totp", "webauthn"]);
  assert.equal(FOUNDATION_MFA_ENFORCEMENT_ENABLED, false);
  assert.equal(isMfaMethodType("email"), true);
  assert.equal(isMfaMethodType("totp"), true);
  assert.equal(isMfaMethodType("webauthn"), true);
  assert.equal(isMfaMethodType("recovery_code"), false);
  assert.equal(isMfaMethodType("trusted_browser"), false);
});
