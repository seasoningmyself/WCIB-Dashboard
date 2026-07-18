import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { AdminOfficeManagementResponse } from "../../../shared/admin-office-locations.js";
import {
  OfficeActiveDialog,
  OfficeEditorDialog,
  OfficeLocationsSettings,
  OfficeLocationsView,
} from "./OfficeLocationsSettings.js";

const OFFICE_A = "00000000-0000-4000-8000-000000000001";
const OFFICE_B = "00000000-0000-4000-8000-000000000002";
const noOp = () => {};

test("office settings renders authoritative mode and retained inactive history", () => {
  const response = fixture();
  const markup = renderToStaticMarkup(
    <OfficeLocationsView
      notice={null}
      onActive={noOp}
      onAdd={noOp}
      onRename={noOp}
      onRetry={noOp}
      pending={false}
      state={{ ...response, status: "ready" }}
    />,
  );
  for (const value of [
    "Office Locations",
    "Required picker.",
    "first active office is selected by default",
    "staff can choose another",
    "San Francisco",
    "Oakland",
    "Retained for historical records",
    "Rename",
    "Deactivate",
    "Reactivate",
  ]) assert.match(markup, new RegExp(value));
  assert.doesNotMatch(markup, />Delete<|localStorage/i);
});

test("deactivating the sole office warns that turn-ins will be blocked", () => {
  const office = fixture().items[0]!;
  const markup = renderToStaticMarkup(
    <OfficeActiveDialog
      dialog={{ active: false, mode: { activeCount: 1, kind: "single", soleOfficeId: office.id }, office }}
      error={null}
      onCancel={noOp}
      onConfirm={noOp}
      pending={false}
    />,
  );
  assert.match(markup, /block all turn-in saves and submissions/);
  assert.match(markup, /Historical references remain intact/);
});

test("office editor preserves a conflicting name and exposes bounded controls", () => {
  const markup = renderToStaticMarkup(
    <OfficeEditorDialog
      dialog={{ kind: "create", name: "Long Office Name" }}
      error="That office name is already in use. Your entry was kept."
      onCancel={noOp}
      onChange={noOp}
      onSubmit={noOp}
      pending={false}
    />,
  );
  assert.match(markup, /value="Long Office Name"/);
  assert.match(markup, /maxLength="200"/i);
  assert.match(markup, /Your entry was kept/);
});

test("office settings fails closed for employee and producer callers", () => {
  for (const role of ["employee", "producer"] as const) {
    const markup = renderToStaticMarkup(<OfficeLocationsSettings user={user(role)} />);
    assert.match(markup, /Office settings unavailable/);
    assert.doesNotMatch(markup, /Loading office locations|Add location|San Francisco/);
  }
});

function fixture(): AdminOfficeManagementResponse {
  return {
    items: [
      { createdAt: "2026-07-12T12:00:00.000Z", id: OFFICE_A, isActive: true, name: "San Francisco", updatedAt: "2026-07-12T12:00:00.000Z" },
      { createdAt: "2026-07-12T12:00:00.000Z", id: OFFICE_B, isActive: false, name: "Oakland", updatedAt: "2026-07-12T12:00:00.000Z" },
      { createdAt: "2026-07-12T12:00:00.000Z", id: "00000000-0000-4000-8000-000000000003", isActive: true, name: "San Jose", updatedAt: "2026-07-12T12:00:00.000Z" },
    ],
    mode: { activeCount: 2, kind: "multiple", soleOfficeId: null },
  };
}

function user(role: CurrentUser["role"]): CurrentUser {
  return {
    allowedNavigation: role === "producer" ? ["my_commissions"] : ["my_items"],
    capabilities: [],
    displayName: "Private Staff",
    email: `${role}@example.test`,
    id: OFFICE_A,
    role,
  };
}
