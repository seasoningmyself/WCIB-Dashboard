import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  pickerMessage,
  rankVocabularyOptions,
  resolveVocabularyBlurDecision,
  resolveVocabularyBlurOption,
  resolvePickerKey,
  shouldOfferInlineAction,
  VocabularyPicker,
  type PickerOption,
} from "./VocabularyPicker.js";
import { resolveCarrierConvenienceMga } from "./pickers.js";

const options: PickerOption[] = [
  { id: "00000000-0000-4000-8000-000000000003", name: "Program Market" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Great American" },
  { id: "00000000-0000-4000-8000-000000000001", name: "AmTrust" },
];

test("picker ranking is prefix, word-prefix, then contains and deterministic", () => {
  assert.deepEqual(
    rankVocabularyOptions(options, "am").map(({ name }) => name),
    ["AmTrust", "Great American", "Program Market"],
  );
  assert.deepEqual(
    rankVocabularyOptions(options, "market").map(({ name }) => name),
    ["Program Market"],
  );
  assert.deepEqual(
    rankVocabularyOptions(options, "").map(({ name }) => name),
    ["AmTrust", "Great American", "Program Market"],
  );
  assert.deepEqual(rankVocabularyOptions(options, "absent"), []);
});

test("residential bond values sort high-to-low within their v15 group", () => {
  const bondOptions: PickerOption[] = [
    { id: "10", name: "Bond - Residential - $10k" },
    { id: "25", name: "Bond - Residential - $25k" },
    { id: "15", name: "Bond - Residential - $15k" },
    { id: "20", name: "Bond - Residential - $20k" },
  ];

  assert.deepEqual(
    rankVocabularyOptions(bondOptions, "bond").map(({ name }) => name),
    [
      "Bond - Residential - $25k",
      "Bond - Residential - $20k",
      "Bond - Residential - $15k",
      "Bond - Residential - $10k",
    ],
  );
});

test("picker blur resolves exact and unique substring values only", () => {
  assert.equal(
    resolveVocabularyBlurOption(options, "  AmTrust. ")?.name,
    "AmTrust",
  );
  assert.equal(
    resolveVocabularyBlurOption(options, "american")?.name,
    "Great American",
  );
  assert.equal(resolveVocabularyBlurOption(options, "a"), null);
  assert.equal(resolveVocabularyBlurOption(options, "missing"), null);
  assert.equal(resolveVocabularyBlurOption(options, ""), null);
});

test("picker blur decisions commit exact and unique matches and restore prior values", () => {
  const previous = options[2]!;

  assert.deepEqual(
    resolveVocabularyBlurDecision(options, "  Great American. ", previous),
    { action: "commit", option: options[1]! },
  );
  assert.deepEqual(resolveVocabularyBlurDecision(options, "market", previous), {
    action: "commit",
    option: options[0]!,
  });
  assert.deepEqual(resolveVocabularyBlurDecision(options, "am", previous), {
    action: "restore",
    option: previous,
  });
  assert.deepEqual(resolveVocabularyBlurDecision(options, "missing", previous), {
    action: "restore",
    option: previous,
  });
});

test("picker keyboard decisions navigate, commit, tab forward, and dismiss", () => {
  assert.deepEqual(
    resolvePickerKey({
      activeIndex: -1,
      canCommit: false,
      key: "ArrowDown",
      optionCount: 3,
    }),
    {
      close: false,
      commitIndex: null,
      nextActiveIndex: 0,
      preventDefault: true,
    },
  );
  assert.equal(
    resolvePickerKey({
      activeIndex: 0,
      canCommit: true,
      key: "ArrowUp",
      optionCount: 3,
    }).nextActiveIndex,
    2,
  );
  assert.deepEqual(
    resolvePickerKey({
      activeIndex: 1,
      canCommit: true,
      key: "Enter",
      optionCount: 3,
    }).commitIndex,
    1,
  );
  const tab = resolvePickerKey({
    activeIndex: -1,
    canCommit: true,
    key: "Tab",
    optionCount: 3,
  });
  assert.equal(tab.commitIndex, 0);
  assert.equal(tab.preventDefault, false);
  assert.equal(
    resolvePickerKey({
      activeIndex: 0,
      canCommit: false,
      key: "Escape",
      optionCount: 3,
    }).close,
    true,
  );
});

test("carrier conveniences use v15 substring matching and identify missing targets", () => {
  const mgas = [
    { id: "00000000-0000-4000-8000-000000000010", name: "CNA" },
    { id: "00000000-0000-4000-8000-000000000011", name: "Travelers" },
  ];
  assert.deepEqual(
    resolveCarrierConvenienceMga("Western Surety Company", mgas),
    { item: mgas[0], name: "CNA" },
  );
  assert.deepEqual(resolveCarrierConvenienceMga("The TRAVELERS Indemnity", mgas), {
    item: mgas[1],
    name: "Travelers",
  });
  assert.deepEqual(resolveCarrierConvenienceMga("Progressive Casualty", mgas), {
    item: null,
    name: "Progressive",
  });
  assert.deepEqual(resolveCarrierConvenienceMga("GEICO Marine", mgas), {
    item: null,
    name: "GEICO",
  });
  assert.equal(resolveCarrierConvenienceMga("Unmapped Carrier", mgas), null);
});

test("inline creation is offered only when no exact active name exists", () => {
  assert.equal(shouldOfferInlineAction(options, "am"), true);
  assert.equal(shouldOfferInlineAction(options, "  AMTRUST  "), false);
  assert.equal(shouldOfferInlineAction(options, ""), false);
});

test("picker renders stable UUID, class metadata, and accessible combobox semantics", () => {
  const markup = renderToStaticMarkup(
    <VocabularyPicker
      getMeta={(option) => option.classTag}
      id="policy-type"
      label="Policy type"
      loadStatus="ready"
      name="policyTypeId"
      onChange={() => {}}
      options={[
        {
          classTag: "Commercial",
          id: options[0]!.id,
          name: "General Liability",
        },
      ]}
      required
      value={options[0]!.id}
    />,
  );

  assert.match(markup, /role="combobox"/);
  assert.match(markup, /aria-autocomplete="list"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /maxLength="200"/i);
  assert.match(markup, /name="policyTypeId"/);
  assert.match(markup, new RegExp(`value="${options[0]!.id}"`));
  assert.match(markup, /General Liability/);
  assert.match(markup, /Commercial/);
  assert.match(markup, /aria-label="Clear Policy type"/);
});

test("picker distinguishes loading, empty, stale, and error states", () => {
  const loading = pickerMarkup("loading", [], null);
  const empty = pickerMarkup("ready", [], null);
  const stale = pickerMarkup(
    "ready",
    options,
    "00000000-0000-4000-8000-000000000099",
  );
  const error = pickerMarkup("error", [], null, true);

  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Loading options/);
  assert.match(empty, /No options are available yet/);
  assert.match(stale, /aria-invalid="true"/);
  assert.match(stale, /selection is no longer available/i);
  assert.match(error, /role="alert"/);
  assert.match(error, />Try again</);
  assert.equal(
    pickerMessage({
      loadStatus: "ready",
      matchCount: 0,
      open: true,
      optionCount: 3,
      query: "missing",
      selectedMeta: null,
      stale: false,
    }),
    "No matching options.",
  );
});

function pickerMarkup(
  loadStatus: "error" | "loading" | "ready",
  pickerOptions: PickerOption[],
  value: string | null,
  retry = false,
): string {
  return renderToStaticMarkup(
    <VocabularyPicker
      id="carrier"
      label="Carrier"
      loadStatus={loadStatus}
      onChange={() => {}}
      onRetry={retry ? () => {} : undefined}
      options={pickerOptions}
      value={value}
    />,
  );
}
