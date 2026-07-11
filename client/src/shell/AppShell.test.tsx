import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
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

test("server-authorized my_items route mounts the real My Drafts screen", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/my-drafts"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["turn_in", "my_items"],
          role: "employee",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading drafts/);
  assert.doesNotMatch(markup, /WCIB workspace/);
});

test("server-authorized approvals route mounts the real admin queue", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/approvals"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["approvals"],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading approvals/);
  assert.doesNotMatch(markup, /WCIB workspace/);
});

test("server-authorized policy ledger route mounts the real admin ledger", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/policy-ledger"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["policy_ledger"],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading policy ledger/);
  assert.doesNotMatch(markup, /WCIB workspace/);
});

test("server-authorized MGA payables route mounts the real admin workspace", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/mga-payables"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["mga_payables"],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading MGA payables/);
  assert.doesNotMatch(markup, /WCIB workspace/);
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
    withApi(
      <AppShellView
        currentPath="/pay-sheets"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["my_commissions"],
          role: "producer",
        }}
      />,
    ),
  );

  assert.match(unknownNavigation, /Workspace access unavailable/);
  assert.doesNotMatch(unknownNavigation, /future_finance_page/);
  assert.doesNotMatch(unknownNavigation, />Pay Sheets</);
  assert.match(unauthorizedPath, /Page not available/);
  assert.doesNotMatch(unauthorizedPath, /Pay Sheets/);
});

function shellMarkup(user: CurrentUser): string {
  return renderToStaticMarkup(withApi(
    <AppShellView currentPath="/" onLogout={() => {}} user={user} />,
  ));
}

function withApi(children: React.ReactNode) {
  return (
    <ApiClientProvider
      boundary={createSessionBoundary(() => {})}
      client={{ async request() { return Response.json({}); } }}
    >
      {children}
    </ApiClientProvider>
  );
}
