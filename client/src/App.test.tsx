import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App.js";

test("App starts with a safe session-bootstrap state", () => {
  const markup = renderToStaticMarkup(<App />);

  assert.match(markup, /Loading your workspace/);
  assert.match(markup, /Checking your secure session/);
  assert.doesNotMatch(markup, /premium|commission|ledger/i);
  assert.doesNotMatch(markup, /localStorage|role chooser/i);
});
