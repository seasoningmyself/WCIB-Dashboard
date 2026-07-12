import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PasswordResetConfirmPanel,
  validatePasswordResetForm,
} from "./PasswordResetConfirmScreen.js";
import { PasswordResetRequestPanel } from "./PasswordResetRequestScreen.js";

const noChange = () => {};
const noSubmit = () => {};
const RESET_TOKEN = "a".repeat(43);

test("reset request completion is generic and contains no account result", () => {
  const pending = renderToStaticMarkup(
    <PasswordResetRequestPanel
      complete={false}
      email="user@example.test"
      error={null}
      onEmailChange={noChange}
      onSubmit={noSubmit}
      pending
    />,
  );
  const complete = renderToStaticMarkup(
    <PasswordResetRequestPanel
      complete
      email=""
      error={null}
      onEmailChange={noChange}
      onSubmit={noSubmit}
      pending={false}
    />,
  );

  assert.match(pending, /Sending/);
  assert.match(pending, /disabled=""/);
  assert.match(complete, /If an account matches that email/);
  assert.doesNotMatch(complete, /exists|does not exist|disabled/i);
  assert.match(complete, /Back to sign in/);
});

test("reset confirmation uses the shared password policy and matching input", () => {
  assert.equal(
    validatePasswordResetForm("short", "short"),
    "password_policy",
  );
  assert.equal(
    validatePasswordResetForm("StrongerPass123!", "DifferentPass123!"),
    "mismatch",
  );
  assert.equal(
    validatePasswordResetForm("StrongerPass123!", "StrongerPass123!"),
    null,
  );

  const markup = renderToStaticMarkup(
    <PasswordResetConfirmPanel
      confirmation=""
      error={null}
      onConfirmationChange={noChange}
      onPasswordChange={noChange}
      onSubmit={noSubmit}
      password=""
      pending={false}
      tokenValid
    />,
  );
  assert.match(markup, /At least 12 characters/);
  assert.match(markup, /At least one uppercase letter/);
  assert.match(markup, /autoComplete="new-password"/i);
  assert.match(markup, /Confirm password/);
  assert.doesNotMatch(markup, new RegExp(RESET_TOKEN));
});

test("invalid, expired, and used links share one safe confirmation state", () => {
  const markup = renderToStaticMarkup(
    <PasswordResetConfirmPanel
      confirmation=""
      error="invalid_token"
      onConfirmationChange={noChange}
      onPasswordChange={noChange}
      onSubmit={noSubmit}
      password=""
      pending={false}
      tokenValid={false}
    />,
  );

  assert.match(markup, /invalid, expired, or has already been used/);
  assert.match(markup, /Request a new reset link/);
  assert.doesNotMatch(markup, /name="password"/);
  assert.doesNotMatch(markup, new RegExp(RESET_TOKEN));
});
