import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
import { AssignmentSettings } from "./AssignmentSettings.js";

const baseUser: CurrentUser = {
  allowedNavigation: ["settings"],
  capabilities: [],
  displayName: "WCIB User",
  email: "user@example.test",
  id: "00000000-0000-4000-8000-000000000001",
  passwordChangeRequired: false,
  role: "employee",
};

test("assignment settings are unavailable to non-admin accounts", () => {
  const markup = renderToStaticMarkup(
    <AssignmentSettings user={baseUser} />,
  );

  assert.match(markup, /Assignment settings unavailable/);
  assert.doesNotMatch(markup, /Loading assignment options|Book available/);
});

test("admin assignment settings reuse the guarded staff projection", () => {
  const markup = renderToStaticMarkup(
    <ApiClientProvider
      boundary={createSessionBoundary(() => {})}
      client={{ async request() { return Response.json({}); } }}
    >
      <AssignmentSettings
        user={{
          ...baseUser,
          capabilities: ["admin"],
          role: "admin",
        }}
      />
    </ApiClientProvider>,
  );

  assert.match(markup, /Loading assignment options/);
  assert.doesNotMatch(markup, /Staff management unavailable/);
});
