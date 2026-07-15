import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BusinessStateGeneration } from "../../../shared/business-state.js";
import {
  BusinessStateDialog,
  BusinessStateSettingsView,
  type TransitionDialog,
} from "./BusinessStateSettings.js";

const noOp = () => {};

test("business-state settings shows metadata-only recovery points", () => {
  const active = generation("00000000-0000-4000-8000-000000000001", "ACTIVE123456", "active");
  const sealed = {
    ...generation("00000000-0000-4000-8000-000000000002", "SEALED123456", "sealed"),
    logicalChecksum: "a".repeat(32),
    rowCounts: {
      approvalQueueEntries: 2, drafts: 3, kpiTargets: 1, mgaPayments: 1,
      paySheetAdjustments: 1, paySheetPolicies: 2, paySheets: 2, policies: 4,
      policyChangeRequests: 1, policyOverrides: 1,
    },
    sealedAt: "2026-07-14T13:00:00.000Z",
  } satisfies BusinessStateGeneration;
  const markup = renderToStaticMarkup(
    <BusinessStateSettingsView
      notice={null}
      onReset={noOp}
      onRestore={noOp}
      onRetry={noOp}
      pending={false}
      state={{ activeGenerationId: active.id, generations: [active, sealed], status: "ready" }}
    />,
  );
  for (const text of ["Business Data", "Start fresh", "Active generation", "ACTIVE123456", "Recovery points", "SEALED123456", "4 policies", "3 drafts", "2 pay sheets", "Restore"]) {
    assert.match(markup, new RegExp(text));
  }
  for (const forbidden of ["insured", "premium", "commission", "password", "DATABASE_URL", "row contents"]) {
    assert.doesNotMatch(markup, new RegExp(forbidden, "i"));
  }
});

test("reset and restore controls stay disabled until exact typed confirmation", () => {
  const sealed = generation("00000000-0000-4000-8000-000000000002", "SEALED123456", "sealed");
  for (const [dialog, enabled] of [
    [{ clearKpiTargets: false, confirmation: "reset", kind: "reset" }, false],
    [{ clearKpiTargets: false, confirmation: "RESET", kind: "reset" }, true],
    [{ confirmation: "RESTORE WRONG", generation: sealed, kind: "restore" }, false],
    [{ confirmation: "RESTORE SEALED123456", generation: sealed, kind: "restore" }, true],
  ] as const) {
    const markup = renderToStaticMarkup(
      <BusinessStateDialog dialog={dialog as TransitionDialog} error={null} onCancel={noOp} onChange={noOp} onSubmit={noOp} pending={false} />,
    );
    const action = markup.match(/<button class="is-danger"([^>]*)>/)?.[1] ?? "";
    assert.equal(action.includes("disabled"), !enabled);
  }
});

function generation(
  id: string,
  code: string,
  status: "active" | "sealed",
): BusinessStateGeneration {
  return {
    baselineChecksum: null,
    clearKpiTargets: false,
    code,
    createdAt: "2026-07-14T12:00:00.000Z",
    id,
    logicalChecksum: status === "sealed" ? "b".repeat(32) : null,
    migrationCount: 48,
    rowCounts: status === "sealed" ? {
      approvalQueueEntries: 0, drafts: 0, kpiTargets: 0, mgaPayments: 0,
      paySheetAdjustments: 0, paySheetPolicies: 0, paySheets: 0, policies: 0,
      policyChangeRequests: 0, policyOverrides: 0,
    } : null,
    schemaFingerprint: "6a06ce086a9beb6b68f788f18afc03712019d56f56003401a9c796fec751991a",
    sealedAt: status === "sealed" ? "2026-07-14T13:00:00.000Z" : null,
    status,
  };
}
