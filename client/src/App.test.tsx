import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App.js";

test("App renders a minimal WCIB shell", () => {
  const markup = renderToStaticMarkup(<App />);

  assert.match(markup, /WCIB Dashboard/);
  assert.match(markup, /Application setup in progress/);
  assert.doesNotMatch(markup, /premium|commission|ledger/i);
});
