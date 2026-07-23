import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  AgencySettings,
  AgencySettingsNavigation,
} from "./AgencySettings.js";

const employee: CurrentUser = {
  allowedNavigation: ["settings"],
  capabilities: [],
  displayName: "Mercedes",
  email: "mercedes@example.test",
  id: "00000000-0000-4000-8000-000000000001",
  passwordChangeRequired: false,
  role: "employee",
};

test("agency settings navigation contains each existing agency controller", () => {
  const markup = renderToStaticMarkup(
    <AgencySettingsNavigation activeTab="offices" onSelect={() => {}} />,
  );

  for (const label of [
    "Offices",
    "Assignment options",
    "Vocabulary",
    "Account security",
    "Data recovery",
  ]) {
    assert.match(markup, new RegExp(`>${label}<`));
  }
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 5);
});

test("agency settings fail closed for non-admin accounts", () => {
  const markup = renderToStaticMarkup(<AgencySettings user={employee} />);

  assert.match(markup, /Agency settings unavailable/);
  assert.match(markup, /restricted to administrators/);
  assert.doesNotMatch(markup, /Office Locations|Start fresh|Managed vocabulary/);
});
