import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  availableGoToShortcuts,
  goToDestination,
} from "./keyboard-shortcuts.js";
import type { ShellNavigationItem } from "./navigation.js";
import { WorkspaceCommandOverlay } from "./WorkspaceCommandOverlay.js";

const navigation: readonly ShellNavigationItem[] = [
  { id: "approvals", label: "Review Queue", path: "/approvals" },
  { id: "turn_in", label: "Check Turn-In", path: "/turn-in" },
  { id: "my_items", label: "My Drafts", path: "/my-drafts" },
];

test("go-to sequences resolve only server-authorized destinations", () => {
  assert.equal(goToDestination("r", navigation)?.path, "/approvals");
  assert.equal(goToDestination("T", navigation)?.path, "/turn-in");
  assert.equal(goToDestination("l", navigation), null);
  assert.equal(goToDestination("x", navigation), null);
});

test("shortcut guide omits destinations the current role cannot reach", () => {
  assert.deepEqual(
    availableGoToShortcuts(navigation).map(({ key, label }) => [key, label]),
    [
      ["r", "Review Queue"],
      ["t", "Check Turn-In"],
      ["d", "My Drafts"],
    ],
  );
});

test("command palette labels only complete shortcuts that actually exist", () => {
  const markup = renderToStaticMarkup(
    <WorkspaceCommandOverlay
      mode="commands"
      navigation={[
        ...navigation,
        { id: "settings", label: "Settings", path: "/settings" },
      ]}
      onClose={() => {}}
      onFocusSearch={() => {}}
      onMode={() => {}}
      onNavigate={() => {}}
    />,
  );

  assert.match(markup, />Review Queue<\/span><kbd>G R<\/kbd>/);
  assert.match(markup, />Check Turn-In<\/span><kbd>G T<\/kbd>/);
  assert.match(markup, />Settings<\/span><\/button>/);
  assert.doesNotMatch(markup, />Settings<\/span><kbd>/);
});
