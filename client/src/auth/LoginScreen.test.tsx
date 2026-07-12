import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginPanel } from "./LoginScreen.js";

const noChange = () => {};
const noSubmit = () => {};

test("login panel is a password-only account form with no role chooser", () => {
  const markup = renderToStaticMarkup(
    <LoginPanel
      email=""
      error={null}
      onEmailChange={noChange}
      onPasswordChange={noChange}
      onSubmit={noSubmit}
      password=""
      pending={false}
    />,
  );

  assert.match(markup, /<form/);
  assert.match(markup, /type="email"/);
  assert.match(markup, /type="password"/);
  assert.match(markup, /autoComplete="username"/i);
  assert.match(markup, /autoComplete="current-password"/i);
  assert.match(markup, /href="#\/reset-password"/);
  assert.match(markup, /type="submit"/);
  assert.doesNotMatch(markup, />\s*(Admin|Employee|Producer)\s*</i);
  assert.doesNotMatch(markup, /localStorage|role chooser|switch role/i);
});

test("login panel renders pending and safe failure states", () => {
  const pending = renderToStaticMarkup(
    <LoginPanel
      email="user@example.test"
      error={null}
      onEmailChange={noChange}
      onPasswordChange={noChange}
      onSubmit={noSubmit}
      password=""
      pending
    />,
  );
  const invalid = renderToStaticMarkup(
    <LoginPanel
      email="user@example.test"
      error="invalid_credentials"
      onEmailChange={noChange}
      onPasswordChange={noChange}
      onSubmit={noSubmit}
      password=""
      pending={false}
    />,
  );
  const network = renderToStaticMarkup(
    <LoginPanel
      email="user@example.test"
      error="network"
      onEmailChange={noChange}
      onPasswordChange={noChange}
      onSubmit={noSubmit}
      password=""
      pending={false}
    />,
  );

  assert.match(pending, /Signing in/);
  assert.match(pending, /disabled=""/);
  assert.match(invalid, /Email or password is incorrect/);
  assert.match(invalid, /role="alert"/);
  assert.match(network, /Check your connection and try again/);
  assert.doesNotMatch(network, /incorrect/i);
});
