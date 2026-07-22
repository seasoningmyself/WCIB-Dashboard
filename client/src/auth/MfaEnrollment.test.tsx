import assert from "node:assert/strict";
import { test } from "node:test";
import { WebAuthnError } from "@simplewebauthn/browser";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import { MfaChallengeScreen } from "./MfaChallengeScreen.js";
import {
  MfaSettingsPanel,
  RecommendedMfaEnrollment,
  RequiredMfaEnrollment,
  enrollmentError,
} from "./MfaEnrollment.js";
import type { MfaApi } from "./mfa-api.js";

const user: CurrentUser = {
  allowedNavigation: ["settings"],
  authenticationState: "authenticated",
  capabilities: ["admin"],
  displayName: "Sophia",
  email: "sophia@example.test",
  id: "00000000-0000-4000-8000-000000000001",
  mfa: {
    adminEnforcementEnabled: false,
    adminRecommended: true,
    enrolled: false,
    enrollmentRequired: false,
    methods: [],
    recoveryCodesAcknowledged: false,
    recoveryCodesRemaining: 0,
  },
  passwordChangeRequired: false,
  role: "admin",
};

const api = {} as MfaApi;

test("recommended admin MFA enrollment can be dismissed without implying enforcement", () => {
  const markup = renderToStaticMarkup(
    <RecommendedMfaEnrollment
      api={api}
      onComplete={async () => {}}
      onDismiss={() => {}}
      user={user}
    />,
  );
  assert.match(markup, /Protect your account/);
  assert.match(markup, />Cancel</);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Continue<\/button>/);
  assert.ok(markup.indexOf(">Cancel<") < markup.indexOf(">Continue<"));
  assert.doesNotMatch(markup, /aria-modal="true"/);
  assert.doesNotMatch(markup, />Sign out</);
});

test("WebAuthn ceremony failures produce actionable messages", () => {
  assert.equal(
    enrollmentError(new WebAuthnError({
      cause: new DOMException("Verification unavailable", "ConstraintError"),
      code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
      message: "User verification is unavailable",
    })),
    "This security key cannot perform the requested verification. Configure its FIDO2 PIN or use another key.",
  );
  assert.equal(
    enrollmentError(new WebAuthnError({
      cause: new DOMException("Cancelled", "NotAllowedError"),
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      message: "Cancelled",
    })),
    "Passkey setup was cancelled or timed out. No passkey was added.",
  );
  assert.equal(
    enrollmentError(new WebAuthnError({
      cause: new DOMException("Invalid domain", "SecurityError"),
      code: "ERROR_INVALID_DOMAIN",
      message: "Invalid domain",
    }), "127.0.0.1"),
    "Open http://localhost:5173 to set up a security key or passkey. Browsers do not accept an IP address for WebAuthn registration.",
  );
});

test("policy-required MFA enrollment remains non-dismissible", () => {
  const markup = renderToStaticMarkup(
    <RequiredMfaEnrollment
      api={api}
      onComplete={async () => {}}
      onLogout={() => {}}
      user={{
        ...user,
        authenticationState: "mfa_enrollment",
        mfa: { ...user.mfa!, enrollmentRequired: true },
      }}
    />,
  );
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, />Sign out</);
  assert.doesNotMatch(markup, />Cancel</);
});

test("recovery-code status warns at the approved 3, 1, and 0 thresholds", () => {
  for (const [remaining, guidance] of [
    [3, "Regenerate soon."],
    [1, "Regenerate soon."],
    [0, "Regenerate codes now."],
  ] as const) {
    const markup = renderToStaticMarkup(
      <MfaSettingsPanel
        api={api}
        initialMfa={{
          ...user.mfa!,
          enrolled: true,
          recoveryCodesAcknowledged: true,
          recoveryCodesRemaining: remaining,
        }}
        onMfaChange={() => {}}
        userId={user.id}
      />,
    );

    assert.match(markup, /mfa-recovery-status is-warning/);
    assert.match(markup, new RegExp(`${remaining}.*${guidance}`));
  }
});

test("an exhausted recovery challenge requires another administrator reset", () => {
  const markup = renderToStaticMarkup(
    <MfaChallengeScreen
      api={api}
      onComplete={async () => {}}
      onLogout={() => {}}
      user={{
        ...user,
        authenticationState: "mfa_challenge",
        mfa: {
          ...user.mfa!,
          enrolled: false,
          methods: [],
          recoveryCodesRemaining: 0,
        },
      }}
    />,
  );

  assert.match(markup, /Recovery codes are exhausted/);
  assert.match(markup, /Another administrator must reset MFA/);
  assert.doesNotMatch(markup, /Authenticator code/);
});

test("unacknowledged recovery codes can be safely replaced on the next login", () => {
  const markup = renderToStaticMarkup(
    <RequiredMfaEnrollment
      api={api}
      onComplete={async () => {}}
      onLogout={() => {}}
      user={{
        ...user,
        authenticationState: "mfa_enrollment",
        mfa: {
          ...user.mfa!,
          enrollmentRequired: true,
          methods: [{
            createdAt: "2026-07-21T12:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000002",
            isPrimary: true,
            label: "Authenticator app",
            lastUsedAt: null,
            methodType: "totp",
          }],
          recoveryCodesAcknowledged: false,
          recoveryCodesRemaining: 10,
        },
      }}
    />,
  );

  assert.match(markup, /Replace your recovery codes/);
  assert.match(markup, /Generate replacement codes/);
  assert.doesNotMatch(markup, /Connect your authenticator app/);
});

test("MFA settings show user-defined method names and individual controls", () => {
  const markup = renderToStaticMarkup(
    <MfaSettingsPanel
      api={api}
      initialMfa={{
        ...user.mfa!,
        adminRecommended: false,
        enrolled: true,
        methods: [
          {
            createdAt: "2026-07-21T12:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000002",
            isPrimary: true,
            label: "Personal YubiKey",
            lastUsedAt: null,
            methodType: "webauthn",
          },
          {
            createdAt: "2026-07-21T12:05:00.000Z",
            id: "00000000-0000-4000-8000-000000000003",
            isPrimary: false,
            label: "Yubico Authenticator",
            lastUsedAt: null,
            methodType: "totp",
          },
        ],
        recoveryCodesAcknowledged: true,
        recoveryCodesRemaining: 10,
      }}
      onMfaChange={() => {}}
      userId={user.id}
    />,
  );

  assert.match(markup, /Personal YubiKey/);
  assert.match(markup, /Yubico Authenticator/);
  assert.match(markup, /aria-label="Rename Personal YubiKey"/);
  assert.match(markup, /aria-label="Remove Personal YubiKey"/);
  assert.match(markup, /Passkey or security key/);
});
