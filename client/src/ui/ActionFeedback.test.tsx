import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActionFeedback,
  REVERSIBLE_ACTION_WINDOW_MS,
} from "./ActionFeedback.js";

test("reversible action feedback exposes a real Undo affordance", () => {
  const markup = renderToStaticMarkup(
    <ActionFeedback
      feedback={{
        actionLabel: "Undo",
        kind: "success",
        message: "MGA payment marked paid.",
        onAction: () => {},
      }}
      onDismiss={() => {}}
      timeoutMs={REVERSIBLE_ACTION_WINDOW_MS}
    />,
  );

  assert.equal(REVERSIBLE_ACTION_WINDOW_MS, 10_000);
  assert.match(markup, /role="status"/);
  assert.match(markup, />MGA payment marked paid\.</);
  assert.match(markup, />Undo</);
  assert.match(markup, /aria-label="Dismiss notification"/);
});

test("failed action feedback is assertive and can offer Retry", () => {
  const markup = renderToStaticMarkup(
    <ActionFeedback
      feedback={{
        actionLabel: "Retry",
        kind: "error",
        message: "The action failed.",
        onAction: () => {},
      }}
      onDismiss={() => {}}
    />,
  );

  assert.match(markup, /role="alert"/);
  assert.match(markup, />Retry</);
});
