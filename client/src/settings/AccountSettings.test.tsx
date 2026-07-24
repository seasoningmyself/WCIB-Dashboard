import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AccountPanel,
  SecurityPanel,
  SettingsSubNavigation,
  settingsSectionFromPath,
  settingsSubnavScrollLeft,
} from "./AccountSettings.js";

test("account settings expose own name with view-only email and office", () => {
  const assigned = renderToStaticMarkup(
    <AccountPanel
      error={null}
      notice={null}
      onSave={() => {}}
      pending={false}
      settings={{
        displayName: "Kaylee",
        email: "kaylee@example.test",
        officeLocation: {
          id: "00000000-0000-4000-8000-000000000010",
          isActive: true,
          name: "West Coast",
        },
      }}
    />,
  );
  const unassigned = renderToStaticMarkup(
    <AccountPanel
      error={null}
      notice={null}
      onSave={() => {}}
      pending={false}
      settings={{
        displayName: "Sophia",
        email: "sophia@example.test",
        officeLocation: null,
      }}
    />,
  );
  const admin = renderToStaticMarkup(
    <AccountPanel
      canManageStaff
      error={null}
      notice={null}
      onSave={() => {}}
      pending={false}
      settings={{
        displayName: "Sophia",
        email: "sophia@example.test",
        officeLocation: null,
      }}
    />,
  );

  assert.match(assigned, /Personal profile/);
  assert.match(assigned, /only account detail you can change here/);
  assert.match(assigned, /Save display name/);
  assert.match(assigned, /value="Kaylee"/);
  assert.match(assigned, /readonly=""[^>]*value="kaylee@example\.test"/i);
  assert.match(assigned, /readonly=""[^>]*value="West Coast"/i);
  assert.equal((assigned.match(/readonly=""/gi) ?? []).length, 2);
  assert.match(unassigned, /value="Not assigned"/);
  assert.equal((admin.match(/href="#\/staff"/g) ?? []).length, 2);
  assert.match(admin, /require MFA confirmation/);
  assert.doesNotMatch(assigned, /userId|capabilities|Role/);
  assert.doesNotMatch(assigned, /role="tabpanel"/);
});

test("settings deep links resolve through one role-aware section hierarchy", () => {
  assert.equal(settingsSectionFromPath("/settings", true), "profile");
  assert.equal(
    settingsSectionFromPath("/settings?scope=agency", true),
    "offices",
  );
  assert.equal(
    settingsSectionFromPath("/settings?section=vocabulary", true),
    "vocabulary",
  );
  assert.equal(
    settingsSectionFromPath("/settings?section=security", false),
    "security",
  );
  assert.equal(
    settingsSectionFromPath("/settings?section=account-security", false),
    "profile",
  );

  const adminNavigation = renderToStaticMarkup(
    <SettingsSubNavigation activeSection="vocabulary" isAdmin />,
  );
  for (const label of [
    "Personal",
    "Profile",
    "Password &amp; MFA",
    "Agency",
    "Offices",
    "Assignment options",
    "Vocabulary",
    "Account security",
    "Data recovery",
  ]) {
    assert.match(adminNavigation, new RegExp(label));
  }
  assert.match(
    adminNavigation,
    /aria-current="page" href="#\/settings\?section=vocabulary"/,
  );

  const staffNavigation = renderToStaticMarkup(
    <SettingsSubNavigation activeSection="profile" isAdmin={false} />,
  );
  assert.doesNotMatch(
    staffNavigation,
    /Agency|Offices|Assignment options|Vocabulary|Account security|Data recovery/,
  );
});

test("mobile settings navigation scrolls the active deep link into view", () => {
  assert.equal(
    settingsSubnavScrollLeft({
      activeLeft: 627,
      activeRight: 730,
      containerLeft: 12,
      containerRight: 378,
      currentScrollLeft: 0,
      maximumScrollLeft: 352,
    }),
    352,
  );
  assert.equal(
    settingsSubnavScrollLeft({
      activeLeft: -80,
      activeRight: 20,
      containerLeft: 12,
      containerRight: 378,
      currentScrollLeft: 200,
      maximumScrollLeft: 352,
    }),
    108,
  );
  assert.equal(
    settingsSubnavScrollLeft({
      activeLeft: 40,
      activeRight: 140,
      containerLeft: 12,
      containerRight: 378,
      currentScrollLeft: 108,
      maximumScrollLeft: 352,
    }),
    108,
  );
});

test("security settings require current password and show shared live policy", () => {
  const markup = renderToStaticMarkup(
    <SecurityPanel
      error={null}
      notice={null}
      onSave={async () => true}
      pending={false}
    />,
  );

  assert.match(markup, /Current password/);
  assert.equal((markup.match(/autoComplete="new-password"/g) ?? []).length, 2);
  assert.match(markup, /At least 12 characters/);
  assert.match(markup, /Not common, compromised, or WCIB-predictable/);
  assert.match(markup, /Different from the current or temporary password/);
  assert.match(markup, /ends every other signed-in session/);
  assert.doesNotMatch(markup, /role="tabpanel"/);
});
