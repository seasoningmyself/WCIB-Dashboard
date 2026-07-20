import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { AuthApi } from "./api.js";
import { PasswordRequirements } from "./PasswordRequirements.js";
import { RequiredPasswordChangeDialog } from "./RequiredPasswordChangeDialog.js";

const user: CurrentUser = {
  allowedNavigation: ["turn_in", "my_items", "settings"],
  capabilities: [],
  displayName: "Mercedes",
  email: "mercedes@example.test",
  id: "00000000-0000-4000-8000-000000000001",
  passwordChangeRequired: true,
  role: "employee",
};

const unusedApi: AuthApi = {
  async changeRequiredPassword() {
    return { ...user, passwordChangeRequired: false };
  },
  async confirmPasswordReset() {},
  async login() {
    return user;
  },
  async logout() {},
  async requestPasswordReset() {},
  async restoreCurrentUser() {
    return user;
  },
};

test("forced-change dialog is modal, non-dismissible, and contains no workspace surface", () => {
  const markup = renderToStaticMarkup(
    <RequiredPasswordChangeDialog
      api={unusedApi}
      onChanged={() => {}}
      onLogout={() => {}}
      temporaryPassword="Initial temporary 2026!"
      user={user}
    />,
  );

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /Create your password/);
  assert.match(markup, /Welcome, Mercedes/);
  assert.equal((markup.match(/type="password"/g) ?? []).length, 2);
  assert.match(markup, /Set password and continue/);
  assert.match(markup, />Sign out</);
  assert.doesNotMatch(markup, />Close<|>Cancel<|aria-label="Close"/i);
  assert.doesNotMatch(markup, /Policy Ledger|Pay Sheets|Check Turn-In/);
});

test("password feedback covers policy, reuse, and confirmation states live", () => {
  const valid = renderToStaticMarkup(
    <PasswordRequirements
      confirmation="Blue harbor lantern 73!"
      password="Blue harbor lantern 73!"
      priorPassword="Initial temporary 2026!"
    />,
  );
  const blocked = renderToStaticMarkup(
    <PasswordRequirements
      confirmation="Westcoastisthebest1!"
      password="Westcoastisthebest1!"
      priorPassword="Westcoastisthebest1!"
    />,
  );

  for (const label of [
    "At least 12 characters",
    "No more than 128 characters",
    "Not common, compromised, or WCIB-predictable",
    "Different from the current or temporary password",
    "Passwords match",
  ]) {
    assert.match(valid, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal((valid.match(/class="is-met"/g) ?? []).length, 5);
  assert.match(blocked, /class="is-not_met"/);
  assert.match(blocked, /Not common, compromised, or WCIB-predictable/);
});
