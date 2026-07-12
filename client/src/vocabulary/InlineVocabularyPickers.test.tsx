import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as inlinePickers from "./InlineVocabularyPickers.js";
import {
  InlineVocabularyAction,
  safeMutationErrorMessage,
} from "./InlineVocabularyPickers.js";

const CANDIDATE_ID = "00000000-0000-4000-8000-000000000001";

test("carrier creation affordance is available to every approved WCIB role", () => {
  for (const role of ["admin", "producer", "employee"] as const) {
    const markup = renderAction({
      errorMessage: null,
      kind: "carrier",
      onSubmit() {},
      pending: false,
      query: "New Carrier",
      role,
    });
    assert.match(markup, />Add carrier</);
    assert.doesNotMatch(markup, /administrator/);
  }
  const unassigned = renderAction({
    errorMessage: null,
    kind: "carrier",
    onSubmit() {},
    pending: false,
    query: "New Carrier",
    role: null,
  });
  assert.match(unassigned, /Ask an administrator/);
  assert.doesNotMatch(unassigned, /<button/);
});

test("policy-type creation requires an explicit approved class", () => {
  const missing = renderAction({
    classTag: "",
    errorMessage: null,
    kind: "policy_type",
    onClassChange() {},
    onSubmit() {},
    pending: false,
    query: "New Policy Type",
    role: "employee",
  });
  const selected = renderAction({
    classTag: "Commercial",
    errorMessage: null,
    kind: "policy_type",
    onClassChange() {},
    onSubmit() {},
    pending: false,
    query: "New Policy Type",
    role: "producer",
  });
  assert.match(missing, /aria-label="Policy class"/);
  assert.match(missing, /<button[^>]*disabled=""[^>]*>Add policy type/);
  assert.match(selected, /<option value="Commercial" selected=""/);
  assert.doesNotMatch(selected, /<button[^>]*disabled/);
});

test("MGA action is hidden from non-admins and confirmation defaults to cancel", () => {
  const employee = renderAction({
    confirmation: null,
    errorMessage: null,
    kind: "mga",
    onCancel() {},
    onConfirm() {},
    onSubmit() {},
    pending: false,
    query: "New MGA",
    role: "employee",
  });
  const admin = renderAction({
    confirmation: null,
    errorMessage: null,
    kind: "mga",
    onCancel() {},
    onConfirm() {},
    onSubmit() {},
    pending: false,
    query: "New MGA",
    role: "admin",
  });
  const confirmation = renderAction({
    confirmation: {
      candidates: [{ id: CANDIDATE_ID, name: "Existing MGA" }],
      name: "Existing MGX",
    },
    errorMessage: null,
    kind: "mga",
    onCancel() {},
    onConfirm() {},
    onSubmit() {},
    pending: false,
    query: "Existing MGX",
    role: "admin",
  });

  assert.match(employee, /Ask an administrator to add this MGA/);
  assert.doesNotMatch(employee, /<button/);
  assert.match(admin, />Add MGA</);
  assert.match(confirmation, /Similar MGAs found/);
  assert.match(confirmation, /Existing MGA/);
  assert.match(confirmation, /<button[^>]*autofocus=""[^>]*>Cancel/);
  assert.match(confirmation, />Add anyway</);
});

test("inline errors are bounded and office creation remains absent", () => {
  assert.equal(
    safeMutationErrorMessage("forbidden", "MGA"),
    "You do not have permission to add this MGA.",
  );
  assert.equal(
    safeMutationErrorMessage("invalid_response", "carrier"),
    "Could not add this carrier. Try again.",
  );
  assert.equal("InlineOfficeLocationPicker" in inlinePickers, false);
});

function renderAction(
  props: React.ComponentProps<typeof InlineVocabularyAction>,
): string {
  return renderToStaticMarkup(<InlineVocabularyAction {...props} />);
}
