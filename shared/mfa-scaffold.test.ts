import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mfaMethodLabelSchema,
  startTotpEnrollmentRequestSchema,
  updateMfaMethodRequestSchema,
  webAuthnCredentialRequestSchema,
} from "./mfa-scaffold.js";

const CHALLENGE_ID = "00000000-0000-4000-8000-000000000001";

test("MFA method nicknames are trimmed and required by every write contract", () => {
  assert.equal(mfaMethodLabelSchema.parse("  Personal YubiKey  "), "Personal YubiKey");
  assert.equal(
    startTotpEnrollmentRequestSchema.parse({ label: " Work phone " }).label,
    "Work phone",
  );
  assert.equal(
    updateMfaMethodRequestSchema.parse({ label: " Backup key " }).label,
    "Backup key",
  );
  assert.equal(
    webAuthnCredentialRequestSchema.parse({
      challengeId: CHALLENGE_ID,
      credential: { id: "credential" },
      label: " Security key ",
    }).label,
    "Security key",
  );

  for (const input of [
    {},
    { label: "" },
    { label: " ".repeat(4) },
    { label: "x".repeat(101) },
  ]) {
    assert.equal(startTotpEnrollmentRequestSchema.safeParse(input).success, false);
    assert.equal(updateMfaMethodRequestSchema.safeParse(input).success, false);
  }
  assert.equal(
    webAuthnCredentialRequestSchema.safeParse({
      challengeId: CHALLENGE_ID,
      credential: { id: "credential" },
    }).success,
    false,
  );
});
