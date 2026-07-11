import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import { AppShellView } from "./AppShell.js";

const baseUser: CurrentUser = {
  allowedNavigation: [],
  capabilities: [],
  displayName: "WCIB User",
  email: "user@example.test",
  id: "00000000-0000-4000-8000-000000000001",
  role: null,
};

test("shell renders the exact admin navigation supplied by /api/me", () => {
  const markup = shellMarkup({
    ...baseUser,
    allowedNavigation: [
      "approvals",
      "help_requests",
      "policy_ledger",
      "mga_payables",
      "pay_sheets",
      "kpis",
      "manage_staff",
      "settings",
      "turn_in",
      "my_items",
      "my_commissions",
    ],
    capabilities: ["admin"],
    displayName: "Sophia",
    role: "admin",
  });

  for (const label of [
    "Approvals",
    "Help Requests",
    "Policy Ledger",
    "MGA Payables",
    "Pay Sheets",
    "KPIs &amp; Goals",
    "Manage Staff",
    "Settings",
    "Check Turn-In",
    "My Drafts",
    "My Commissions",
  ]) {
    assert.match(markup, new RegExp(`>${label}<`));
  }
  assert.match(markup, /aria-label="Primary navigation"/);
  assert.match(markup, /<main[^>]*tabindex="-1"/i);
  assert.match(markup, /<button[^>]*>Sign out<\/button>/);
});

test("producer and employee shells render only their universal draft navigation", () => {
  const producer = shellMarkup({
    ...baseUser,
    allowedNavigation: ["turn_in", "my_items", "my_commissions"],
    displayName: "Kaylee",
    role: "producer",
  });
  const employee = shellMarkup({
    ...baseUser,
    allowedNavigation: ["turn_in", "my_items"],
    displayName: "Mercedes",
    role: "employee",
  });

  assert.match(producer, />Check Turn-In</);
  assert.match(producer, />My Drafts</);
  assert.match(producer, />My Commissions</);
  assert.doesNotMatch(producer, />Pay Sheets</);

  assert.match(employee, />Check Turn-In</);
  assert.match(employee, />My Drafts</);
  assert.doesNotMatch(employee, />My Commissions</);
  assert.doesNotMatch(employee, />Policy Ledger</);
});

test("unknown IDs and unauthorized URLs fail closed in the shell", () => {
  const unknownUser = {
    ...baseUser,
    allowedNavigation: ["future_finance_page"],
    capabilities: ["admin"],
    role: "admin",
  } as unknown as CurrentUser;
  const unknownNavigation = shellMarkup(unknownUser);
  const unauthorizedPath = renderToStaticMarkup(
    <AppShellView
      currentPath="/pay-sheets"
      onLogout={() => {}}
      user={{
        ...baseUser,
        allowedNavigation: ["my_commissions"],
        role: "producer",
      }}
    />,
  );

  assert.match(unknownNavigation, /Workspace access unavailable/);
  assert.doesNotMatch(unknownNavigation, /future_finance_page/);
  assert.doesNotMatch(unknownNavigation, />Pay Sheets</);
  assert.match(unauthorizedPath, /Page not available/);
  assert.doesNotMatch(unauthorizedPath, /Pay Sheets/);
});

function shellMarkup(user: CurrentUser): string {
  return renderToStaticMarkup(
    <AppShellView currentPath="/" onLogout={() => {}} user={user} />,
  );
}
