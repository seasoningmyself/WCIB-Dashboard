import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  passwordChangeRequired: false,
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
  ]) {
    assert.match(markup, new RegExp(`>${label}<`));
  }
  assert.match(markup, /aria-label="Primary navigation"/);
  assert.match(markup, />Daily<\/h2>/);
  assert.match(markup, />Money<\/h2>/);
  assert.match(markup, />Setup<\/h2>/);
  assert.match(markup, /<main[^>]*tabindex="-1"/i);
  assert.match(markup, /<button[^>]*>Sign out<\/button>/);
  assert.match(markup, /aria-controls="workspace-mobile-panel"/);
  assert.match(markup, /aria-expanded="false"/);
});

test("producer and employee shells degrade grouped navigation by authorization", () => {
  const producer = shellMarkup({
    ...baseUser,
    allowedNavigation: ["turn_in", "my_items", "my_commissions", "settings"],
    displayName: "Kaylee",
    role: "producer",
  });
  const employee = shellMarkup({
    ...baseUser,
    allowedNavigation: ["turn_in", "my_items", "settings"],
    displayName: "Mercedes",
    role: "employee",
  });

  assert.match(producer, />Check Turn-In</);
  assert.match(producer, />My Drafts</);
  assert.match(producer, />My Commissions</);
  assert.match(producer, />Daily<\/h2>/);
  assert.match(producer, />Money<\/h2>/);
  assert.match(producer, />Setup<\/h2>/);
  assert.doesNotMatch(producer, />Pay Sheets</);

  assert.match(employee, />Check Turn-In</);
  assert.match(employee, />My Drafts</);
  assert.match(employee, />Daily<\/h2>/);
  assert.match(employee, />Setup<\/h2>/);
  assert.doesNotMatch(employee, />Money<\/h2>/);
  assert.doesNotMatch(employee, />My Commissions</);
  assert.doesNotMatch(employee, />Policy Ledger</);
});

test("shell renders count badges only for positive projected counts", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/approvals"
        navigationCounts={{
          approvals: 3,
          help_requests: 0,
          mga_payables: 7,
          pay_sheets: 2,
        }}
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: [
            "approvals",
            "help_requests",
            "mga_payables",
            "pay_sheets",
          ],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );

  assert.match(markup, /aria-label="3 items need attention"[^>]*>3</);
  assert.doesNotMatch(markup, /0 items need attention/);
  assert.doesNotMatch(markup, /<select|<option|<optgroup/);
});

test("mobile navigation is a modal sheet with keyboard dismissal and focus containment", () => {
  const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /mobileMenuButtonRef\.current\?\.focus\(\)/);
});

test("server-authorized staff my_items route mounts the status-only My Items screen", () => {
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

  assert.match(markup, /Loading My Items/);
  assert.doesNotMatch(markup, /WCIB workspace/);
});

test("admin My Drafts and staff edit links preserve the Parent C editor flow", () => {
  const admin = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/my-drafts"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["turn_in", "my_items"],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );
  const employeeEdit = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/my-drafts?draft=00000000-0000-4000-8000-000000000010"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["turn_in", "my_items"],
          role: "employee",
        }}
      />,
    ),
  );

  assert.match(admin, /Loading drafts/);
  assert.match(employeeEdit, /Loading drafts/);
  assert.doesNotMatch(employeeEdit, /Loading My Items/);
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

test("server-authorized Help Requests route mounts the dedicated admin screen", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/help-requests"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["help_requests"],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading Help Requests/);
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

test("server-authorized pay sheets route mounts the real admin workspace", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/pay-sheets"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["pay_sheets"],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading pay sheets/);
  assert.doesNotMatch(markup, /WCIB workspace/);
});

test("server-authorized KPI route mounts the real admin goals workspace", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/kpis"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["kpis"],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading KPIs/);
  assert.doesNotMatch(markup, /WCIB workspace/);
});

test("server-authorized Manage Staff route mounts the real admin workspace", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/staff"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["manage_staff"],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading staff/);
  assert.doesNotMatch(markup, /WCIB workspace/);
});

test("server-authorized Settings route mounts real own-account settings", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/settings"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["settings"],
          capabilities: ["admin"],
          role: "admin",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading settings/);
  assert.doesNotMatch(markup, /WCIB workspace/);
});

test("server-authorized My Commissions route mounts the real producer workspace", () => {
  const markup = renderToStaticMarkup(
    withApi(
      <AppShellView
        currentPath="/my-commissions"
        onLogout={() => {}}
        user={{
          ...baseUser,
          allowedNavigation: ["turn_in", "my_items", "my_commissions"],
          role: "producer",
        }}
      />,
    ),
  );

  assert.match(markup, /Loading commissions/);
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

  assert.match(unknownNavigation, /No pages available for this account/);
  assert.match(unknownNavigation, /Ask an administrator to check your role and access/);
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
