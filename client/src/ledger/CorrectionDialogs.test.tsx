import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
import { VocabularyProvider } from "../vocabulary/context.js";
import { PolicyCorrectionDialog } from "./CorrectionDialogs.js";
import { ledgerItemFixture } from "./test-fixture.js";

test("general correction dialog exposes general fields and excludes override-managed fields", () => {
  const markup = dialogMarkup("general", false);

  for (const generalField of [
    "Insured",
    "Policy type",
    "Carrier",
    "MGA",
    "Account assignment",
    "Base premium",
    "Commission rate",
    "Amount collected",
    "Payment mode",
    "Finance contact",
    "Finance metadata",
  ]) {
    assert.match(markup, new RegExp(`>${generalField}<`));
  }
  for (const protectedField of [
    "Agency commission",
    "Broker fee",
    "Net due",
    "Commission mode",
  ]) {
    assert.doesNotMatch(markup, new RegExp(`>${protectedField}<`));
  }
  assert.match(markup, /Save correction/);
});

test("override dialog exposes exactly the protected financial correction surface", () => {
  const markup = dialogMarkup("override", false);

  for (const protectedField of [
    "Agency commission",
    "Broker fee",
    "Net due",
    "Commission mode",
  ]) {
    assert.match(markup, new RegExp(`>${protectedField}<`));
  }
  for (const generalField of ["Insured", "Carrier", "Base premium", "Finance contact"]) {
    assert.doesNotMatch(markup, new RegExp(`>${generalField}<`));
  }
  assert.match(markup, /Apply financial override/);
});

test("pending correction dialog disables dismissal and submission controls", () => {
  const markup = dialogMarkup("override", true);

  assert.match(markup, /aria-label="Close" disabled=""/);
  assert.match(markup, /disabled=""[^>]*>Cancel/);
  assert.match(markup, /disabled=""[^>]*>Saving\.\.\./);
});

function dialogMarkup(kind: "general" | "override", pending: boolean): string {
  return renderToStaticMarkup(
    <ApiClientProvider
      boundary={createSessionBoundary(() => {})}
      client={{ async request() { return Response.json({}); } }}
    >
      <VocabularyProvider>
        <PolicyCorrectionDialog
          assignmentOptions={[]}
          dialog={{ item: ledgerItemFixture(), kind }}
          onCancel={() => {}}
          onSubmit={() => {}}
          pending={pending}
        />
      </VocabularyProvider>
    </ApiClientProvider>,
  );
}
