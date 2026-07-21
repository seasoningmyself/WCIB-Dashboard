import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "./EmptyState.js";
import { PageHeader } from "./PageHeader.js";

test("page header renders the Coastal hierarchy and tide rule", () => {
  const markup = renderToStaticMarkup(
    <PageHeader
      actions={<button type="button">Review history</button>}
      eyebrow="Policy review"
      status={<><strong>3</strong> items waiting for review.</>}
      title="Approvals"
      titleId="approvals-title"
    />,
  );

  assert.match(markup, /page-heading-eyebrow[^>]*>Policy review/);
  assert.match(markup, /<h1 id="approvals-title">Approvals<\/h1>/);
  assert.match(markup, /page-heading-status[^>]*><strong>3<\/strong>/);
  assert.match(markup, /class="tide-rule" aria-hidden="true"><span><\/span><span><\/span><span><\/span>/);
  assert.match(markup, />Review history<\/button>/);
});

test("empty state keeps explanatory copy and action left in the content flow", () => {
  const markup = renderToStaticMarkup(
    <EmptyState
      action={<a href="#/turn-in">Start a turn-in</a>}
      body="Approved policies will appear here after review."
      className="ledger-empty"
      heading="No policies in the ledger"
      headingId="ledger-empty-title"
    />,
  );

  assert.match(markup, /class="app-empty-state ledger-empty"/);
  assert.match(markup, /<h2 id="ledger-empty-title">No policies in the ledger<\/h2>/);
  assert.match(markup, /Approved policies will appear here after review\./);
  assert.match(markup, /app-empty-state-action[^>]*><a href="#\/turn-in">Start a turn-in<\/a>/);
});
