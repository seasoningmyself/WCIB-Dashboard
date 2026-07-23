import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  findVocabularyExactMatch,
  filterVocabularyItems,
  VocabularyManagementView,
  type VocabularyManagementState,
} from "./VocabularyManagement.js";

const ID = "00000000-0000-4000-8000-000000000001";
const noop = () => undefined;
const added = async () => true;

test("managed vocabulary opens a focused active-company workspace", () => {
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
    "Search or add insurance companies",
    "Used Carrier",
    "In use",
    "Deactivate",
    "Active (1)",
    "Inactive (0)",
    "Page 1 of 1",
  ]) {
    assert.match(markup, new RegExp(visible.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(
    markup,
    /<button disabled="" title="Used by the active ledger" type="button">Deactivate/,
  );
  assert.doesNotMatch(
    markup,
    /Historical MGA|Group Health|Life-Health|Add MGA|Add type|Reactivate/,
  );
  assert.doesNotMatch(markup, /Delete|premiumTotal|agencyTotal|localStorage/i);
});

test("vocabulary filtering separates active and inactive entries before search", () => {
  const items = [
    { id: `${ID.slice(0, -1)}1`, inUse: false, isActive: true, name: "Alpha Carrier" },
    { id: `${ID.slice(0, -1)}2`, inUse: false, isActive: true, name: "Beta Carrier" },
    { id: `${ID.slice(0, -1)}3`, inUse: false, isActive: false, name: "Alpha Historical" },
  ];

  assert.deepEqual(
    filterVocabularyItems(items, "alpha", "active").map(({ name }) => name),
    ["Alpha Carrier"],
  );
  assert.deepEqual(
    filterVocabularyItems(items, "", "inactive").map(({ name }) => name),
    ["Alpha Historical"],
  );
});

test("vocabulary creation is suppressed for exact active or inactive matches", () => {
  const items = [
    { id: `${ID.slice(0, -1)}1`, inUse: false, isActive: true, name: "Alpha Carrier" },
    { id: `${ID.slice(0, -1)}2`, inUse: false, isActive: false, name: "Historical MGA" },
  ];

  assert.equal(
    findVocabularyExactMatch(items, "  alpha carrier  ")?.name,
    "Alpha Carrier",
  );
  assert.equal(
    findVocabularyExactMatch(items, "HISTORICAL MGA")?.isActive,
    false,
  );
  assert.equal(findVocabularyExactMatch(items, "Alpha"), null);
  assert.equal(findVocabularyExactMatch(items, ""), null);
});

test("managed vocabulary limits the first page to 25 rows", () => {
  const carriers = Array.from({ length: 30 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    inUse: false,
    isActive: true,
    name: `Carrier ${String(index + 1).padStart(2, "0")}`,
  }));
  const markup = render({
    data: { carriers, mgas: [], policyTypes: [] },
    status: "ready",
  });

  assert.match(markup, /Carrier 25/);
  assert.doesNotMatch(markup, /Carrier 26/);
  assert.match(markup, /Page 1 of 2/);
  assert.match(markup, />Next</);
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
