import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupportAccountSecurityItem } from "../../../shared/support-account-security.js";
import {
  SupportMfaAccountList,
  SupportMfaResetDialog,
} from "./SupportMfaRecovery.js";

const account: SupportAccountSecurityItem = {
  displayName: "Sophia",
  email: "sophia@example.test",
  id: "00000000-0000-4000-8000-000000000001",
  lastLoginAt: "2026-07-22T12:00:00.000Z",
  mfa: {
    enrolled: true,
    enrollmentRequired: false,
    methods: [
      {
        createdAt: "2026-07-20T12:00:00.000Z",
        isPrimary: true,
        label: "YubiKey 5 NFC",
        lastUsedAt: "2026-07-22T12:00:00.000Z",
        methodType: "webauthn",
      },
      {
        createdAt: "2026-07-21T12:00:00.000Z",
        isPrimary: false,
        label: "Microsoft Authenticator",
        lastUsedAt: null,
        methodType: "totp",
      },
    ],
    recoveryCodesRemaining: 7,
  },
};

test("support recovery renders every safe MFA method field", () => {
  const markup = renderToStaticMarkup(
    <SupportMfaAccountList items={[account]} onReset={() => {}} />,
  );

  for (const expected of [
    "Sophia",
    "sophia@example.test",
    "Last login",
    "YubiKey 5 NFC",
    "Passkey / Primary",
    "Microsoft Authenticator",
    "Authenticator app",
    "7 recovery codes remaining",
  ]) {
    assert.match(markup, new RegExp(expected));
  }
  assert.doesNotMatch(
    markup,
    /credentialId|encryptedSecret|publicKey|recovery code:|session token/i,
  );
});

test("support reset confirmation names every method being removed", () => {
  const markup = renderToStaticMarkup(
    <SupportMfaResetDialog
      draft={{ item: account, reason: "" }}
      onCancel={() => {}}
      onReason={() => {}}
      onSubmit={() => {}}
    />,
  );

  assert.match(markup, /remove 2 active methods/);
  assert.match(markup, /YubiKey 5 NFC \(Passkey, primary\)/);
  assert.match(markup, /Microsoft Authenticator \(Authenticator app\)/);
  assert.match(markup, /7 recovery codes will be revoked/);
});
