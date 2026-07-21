import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupAuthorizedNavigation,
  normalizeShellPath,
  resolveAuthorizedNavigation,
  resolveShellRoute,
} from "./navigation.js";

test("navigation maps only explicit server-issued identifiers", () => {
  const navigation = resolveAuthorizedNavigation([
    "my_items",
    "my_commissions",
    "future_admin_page",
    "my_commissions",
  ]);

  assert.deepEqual(navigation, [
    {
      id: "my_items",
      label: "My Drafts",
      path: "/my-drafts",
    },
    {
      id: "my_commissions",
      label: "My Commissions",
      path: "/my-commissions",
    },
  ]);
});

test("navigation groups authorized pages in Coastal task order", () => {
  const groups = groupAuthorizedNavigation(resolveAuthorizedNavigation([
    "settings",
    "my_commissions",
    "turn_in",
    "my_items",
  ]));

  assert.deepEqual(
    groups.map(({ id, items, label }) => ({
      id,
      items: items.map((item) => item.id),
      label,
    })),
    [
      { id: "daily", items: ["turn_in", "my_items"], label: "Daily" },
      { id: "money", items: ["my_commissions"], label: "Money" },
      { id: "setup", items: ["settings"], label: "Setup" },
    ],
  );
});

test("shell routes cannot select an unauthorized or external destination", () => {
  const navigation = resolveAuthorizedNavigation([
    "turn_in",
    "my_items",
    "my_commissions",
  ]);

  assert.deepEqual(resolveShellRoute("/", navigation), {
    item: navigation[0],
    status: "ready",
  });
  assert.deepEqual(resolveShellRoute("/my-drafts", navigation), {
    item: navigation[1],
    status: "ready",
  });
  assert.deepEqual(resolveShellRoute("/my-commissions", navigation), {
    item: navigation[2],
    status: "ready",
  });
  assert.deepEqual(resolveShellRoute("/pay-sheets", navigation), {
    status: "not_found",
  });
  assert.deepEqual(resolveShellRoute("/anything", []), { status: "empty" });
  assert.equal(normalizeShellPath("https://outside.example/path"), "/");
  assert.equal(normalizeShellPath("//outside.example/path"), "/");
});
