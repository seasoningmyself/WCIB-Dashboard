import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PaySheetExportControls,
  PaySheetFullExportDialog,
} from "./PaySheetExportControls.js";

const periods = [
  { key: "2026-07", label: "July 2026", periodMonth: 7, periodYear: 2026 },
  { key: "2026-06", label: "June 2026", periodMonth: 6, periodYear: 2026 },
] as const;

test("export toolbar renders exact full-agency and UUID-owned scope controls", () => {
  const markup = renderToStaticMarkup(
    <PaySheetExportControls
      activeOwnerAvailable
      activeOwnerLabel="Sophia"
      disabled={false}
      onAction={() => {}}
      onPeriod={() => {}}
      periods={periods}
      selectedPeriodKey="2026-07"
      state={{ status: "idle" }}
    />,
  );
  for (const visible of [
    "Admin confidential",
    "Export &amp; print",
    "Report period",
    "July 2026",
    "June 2026",
    "Full agency",
    "All owners",
    "Sophia",
    "Selected owner",
    "Excel",
    "Print",
  ]) assert.match(markup, new RegExp(visible));
  assert.equal((markup.match(/>Excel</g) ?? []).length, 2);
  assert.equal((markup.match(/>Print</g) ?? []).length, 2);
  assert.doesNotMatch(markup, /localStorage|sessionStorage|commissionAmount|sophiaTakeHome/);
});

test("owner-unavailable, pending, success, and failure states stay bounded", () => {
  const unavailable = renderToolbar({
    activeOwnerAvailable: false,
    state: { status: "idle" },
  });
  assert.match(unavailable, /No sheet in this period/);
  assert.equal((unavailable.match(/disabled=""/g) ?? []).length, 2);

  const pending = renderToolbar({
    activeOwnerAvailable: true,
    state: { action: { format: "print", scope: "owner" }, status: "pending" },
  });
  assert.match(pending, /Preparing print view/);
  assert.match(pending, /role="status"/);

  const error = renderToolbar({
    activeOwnerAvailable: true,
    state: { message: "The report could not be opened. Try again.", status: "error" },
  });
  assert.match(error, /role="alert"/);
  assert.match(error, /Try again/);
});

test("full-agency confirmation names the period and report scope", () => {
  const markup = renderToStaticMarkup(
    <PaySheetFullExportDialog
      action={{ format: "excel", scope: "all" }}
      onCancel={() => {}}
      onConfirm={() => {}}
      pending={false}
      periodLabel="July 2026"
    />,
  );
  assert.match(markup, /Full agency \/ July 2026/);
  assert.match(markup, /every owner with a pay sheet/);
  assert.match(markup, /Download Excel/);
});

function renderToolbar({
  activeOwnerAvailable,
  state,
}: {
  activeOwnerAvailable: boolean;
  state: Parameters<typeof PaySheetExportControls>[0]["state"];
}): string {
  return renderToStaticMarkup(
    <PaySheetExportControls
      activeOwnerAvailable={activeOwnerAvailable}
      activeOwnerLabel="Kaylee"
      disabled={false}
      onAction={() => {}}
      onPeriod={() => {}}
      periods={periods}
      selectedPeriodKey="2026-06"
      state={state}
    />,
  );
}
