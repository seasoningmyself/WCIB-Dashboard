import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  VocabularyManagementView,
  type VocabularyManagementState,
} from "./VocabularyManagement.js";

const ID = "00000000-0000-4000-8000-000000000001";
const noop = () => undefined;
const added = async () => true;

test("managed vocabulary renders v15 search, class, add, and guarded state controls", () => {
  const markup = render({
    data: {
      carriers: [
        { id: ID, inUse: true, isActive: true, name: "Used Carrier" },
      ],
      mgas: [
        { id: ID, inUse: false, isActive: false, name: "Historical MGA" },
      ],
      policyTypes: [
        {
          classTag: "Life-Health",
          id: ID,
          inUse: false,
          isActive: true,
          name: "Group Health",
        },
      ],
    },
    status: "ready",
  });

  for (const visible of [
    "Managed vocabulary",
    "Insurance companies",
    "MGA / payees",
    "Policy types",
    "Add company",
    "Add MGA",
    "Add type",
    "Search insurance companies",
    "Used Carrier",
    "Historical MGA",
    "Group Health",
    "Life-Health",
    "In use",
    "Deactivate",
    "Reactivate",
  ]) {
    assert.match(markup, new RegExp(visible.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(
    markup,
    /<button disabled="" title="Used by the active ledger" type="button">Deactivate/,
  );
  assert.doesNotMatch(markup, /Delete|premiumTotal|agencyTotal|localStorage/i);
});

test("managed vocabulary exposes safe loading, failure, and denied states", () => {
  assert.match(render({ status: "loading" }), /Loading managed lists/);
  assert.match(render({ status: "error" }), /Try again/);
  assert.match(render({ status: "denied" }), /restricted to administrators/);
});

function render(state: VocabularyManagementState): string {
  return renderToStaticMarkup(
    <VocabularyManagementView
      notice={null}
      onAddCarrier={added}
      onAddMga={added}
      onAddPolicyType={async () => true}
      onRetry={noop}
      onSetActive={noop}
      pending={false}
      state={state}
    />,
  );
}
