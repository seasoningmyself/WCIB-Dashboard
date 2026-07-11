import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeShellPath,
  resolveAuthorizedNavigation,
  resolveShellRoute,
} from "./navigation.js";

test("navigation maps only explicit server-issued identifiers", () => {
  const navigation = resolveAuthorizedNavigation([
    "my_commissions",
    "future_admin_page",
    "my_commissions",
  ]);

  assert.deepEqual(navigation, [
    {
      id: "my_commissions",
      label: "My Commissions",
      path: "/my-commissions",
    },
  ]);
});

test("shell routes cannot select an unauthorized or external destination", () => {
  const navigation = resolveAuthorizedNavigation(["my_commissions"]);

  assert.deepEqual(resolveShellRoute("/", navigation), {
    item: navigation[0],
    status: "ready",
  });
  assert.deepEqual(resolveShellRoute("/my-commissions", navigation), {
    item: navigation[0],
    status: "ready",
  });
  assert.deepEqual(resolveShellRoute("/pay-sheets", navigation), {
    status: "not_found",
  });
  assert.deepEqual(resolveShellRoute("/anything", []), { status: "empty" });
  assert.equal(normalizeShellPath("https://outside.example/path"), "/");
  assert.equal(normalizeShellPath("//outside.example/path"), "/");
});
