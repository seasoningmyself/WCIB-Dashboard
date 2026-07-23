import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../shared/current-user.js";
import { App, resolveAuthenticatedPath } from "./App.js";

test("App starts with a safe session-bootstrap state", () => {
  const markup = renderToStaticMarkup(<App />);

  assert.match(markup, /Loading your workspace/);
  assert.match(markup, /Checking your secure session/);
  assert.doesNotMatch(markup, /premium|commission|ledger/i);
  assert.doesNotMatch(markup, /localStorage|role chooser/i);
});

test("post-login routing preserves valid deep links and rejects stale role pages", () => {
  const producer: CurrentUser = {
    allowedNavigation: [
      "my_commissions",
      "turn_in",
      "my_items",
      "settings",
    ],
    capabilities: [],
    displayName: "Kaylee",
    email: "kaylee@example.test",
    id: "00000000-0000-4000-8000-000000000001",
    passwordChangeRequired: false,
    role: "producer",
  };

  assert.equal(
    resolveAuthenticatedPath(producer, "/staff", null),
    "/",
  );
  assert.equal(
    resolveAuthenticatedPath(producer, "/staff", "/my-commissions"),
    "/my-commissions",
  );
  assert.equal(
    resolveAuthenticatedPath(producer, "/my-drafts", null),
    "/my-drafts",
  );
});
