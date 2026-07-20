import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountPanel, SecurityPanel } from "./AccountSettings.js";

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

  assert.match(assigned, /Account details/);
  assert.match(assigned, /value="Kaylee"/);
  assert.match(assigned, /readonly=""[^>]*value="kaylee@example\.test"/i);
  assert.match(assigned, /readonly=""[^>]*value="West Coast"/i);
  assert.equal((assigned.match(/readonly=""/gi) ?? []).length, 2);
  assert.match(unassigned, /value="Not assigned"/);
  assert.doesNotMatch(assigned, /userId|capabilities|Role/);
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
});
