import assert from "node:assert/strict";
import { test } from "node:test";
import { supportAccountSecurityItemSchema } from "./support-account-security.js";

const safeItem = {
  displayName: "Sophia",
  email: "sophia@example.test",
  id: "00000000-0000-4000-8000-000000000001",
  lastLoginAt: "2026-07-22T12:00:00.000Z",
  mfa: {
    enrolled: true,
    enrollmentRequired: false,
    methods: [{
      createdAt: "2026-07-20T12:00:00.000Z",
      isPrimary: true,
      label: "YubiKey 5 NFC",
      lastUsedAt: "2026-07-22T12:00:00.000Z",
      methodType: "webauthn",
    }],
    recoveryCodesRemaining: 8,
  },
};

test("support MFA projection accepts summaries and rejects credential material", () => {
  assert.deepEqual(supportAccountSecurityItemSchema.parse(safeItem), safeItem);
  assert.equal(
    supportAccountSecurityItemSchema.safeParse({
      ...safeItem,
      mfa: {
        ...safeItem.mfa,
        methods: [{
          ...safeItem.mfa.methods[0],
          credentialId: "credential-material",
        }],
      },
    }).success,
    false,
  );
});
