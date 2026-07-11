import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  pickerMessage,
  rankVocabularyOptions,
  resolvePickerKey,
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

test("fixed carrier conveniences resolve only an existing active MGA", () => {
  const mgas = [
    { id: "00000000-0000-4000-8000-000000000010", name: "CNA" },
    { id: "00000000-0000-4000-8000-000000000011", name: "Travelers" },
  ];
  assert.deepEqual(resolveCarrierConvenienceMga("Western Surety", mgas), mgas[0]);
  assert.deepEqual(resolveCarrierConvenienceMga("TRAVELERS", mgas), mgas[1]);
  assert.equal(resolveCarrierConvenienceMga("Progressive", mgas), null);
  assert.equal(resolveCarrierConvenienceMga("Unmapped Carrier", mgas), null);
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
