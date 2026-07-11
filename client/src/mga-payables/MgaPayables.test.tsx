import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  MAX_MGA_PAYMENT_REFERENCE_LENGTH,
  type MgaPayableListResponse,
} from "../../../shared/mga-payables.js";
import {
  MgaPayables,
  MgaPayablesView,
  MgaPaymentStateDialog,
} from "./MgaPayables.js";
import {
  payableItemFixture,
  payablesFixture,
  uuid,
} from "./test-fixture.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");

test("admin view renders server totals, stored net due, deterministic groups, and actions", () => {
  const data = populatedFixture();
  const markup = renderView(data);

  for (const visible of [
    "MGA Payables",
    "Total outstanding",
    "$1,075.01",
    "Paid",
    "$400.00",
    "1 / 3",
    "Alpha Managing General Agency",
    "Beta MGA",
    "Acme Construction",
    "Beacon Bakery",
    "Cobalt Roofing",
    "$850.00",
    "$225.01",
    "$400.00",
    "Override",
    "40d",
    "71d overdue",
    "Kaylee account",
    "Kaylee first year",
    "Sophia house",
    "Mark paid",
    "Unmark",
    "WIRE-400",
  ]) {
    assert.match(markup, new RegExp(escapeRegExp(visible)));
  }

  assert.match(markup, /Alpha Managing General Agency[\s\S]*Beta MGA/);
  assert.match(markup, /Acme Construction[\s\S]*Beacon Bakery/);
  for (const forbidden of [
    "Mark all",
    "Unmark all",
    "Amount collected",
    "Agency commission",
    "Open balance",
    "Reminder",
  ]) {
    assert.doesNotMatch(markup, new RegExp(escapeRegExp(forbidden), "i"));
  }
});

test("view exposes loading, denied, failure, blank, and filtered-empty states", () => {
  assert.match(renderState({ status: "loading" }), /Loading MGA payables/);
  assert.match(renderState({ status: "denied" }), /MGA payables unavailable/);
  assert.match(renderState({ status: "error" }), /Try again/);

  const blank = payablesFixture();
  blank.groups = [];
  blank.summary = totals("0.00", "0.00", 0, 0, 0);
  assert.match(renderView(blank), /No approved policies yet/);

  const filtered = structuredClone(blank);
  filtered.status = "paid";
  filtered.summary = totals("850.00", "0.00", 0, 1, 1);
  assert.match(renderView(filtered, "paid"), /No paid payables/);
  assert.match(renderView(filtered, "paid"), /Choose another payment-status filter/);
});

test("non-admin entry fails closed before mounting the API-backed controller", () => {
  for (const role of ["employee", "producer"] as const) {
    const user: CurrentUser = {
      allowedNavigation: role === "producer"
        ? ["turn_in", "my_items", "my_commissions"]
        : ["turn_in", "my_items"],
      capabilities: [],
      displayName: "Private Staff",
      email: `${role}@example.test`,
      id: uuid(role === "employee" ? 91 : 92),
      role,
    };
    const markup = renderToStaticMarkup(<MgaPayables user={user} />);

    assert.match(markup, /MGA payables unavailable/);
    assert.doesNotMatch(markup, /Loading MGA payables|Net due|\$850\.00/);
  }
});

test("payment dialogs bound the reference and explain open-only unmark behavior", () => {
  const item = payableItemFixture();
  const mark = renderToStaticMarkup(
    <MgaPaymentStateDialog
      dialog={{ item, targetStatus: "paid" }}
      error={null}
      onCancel={() => {}}
      onSubmit={() => {}}
      pending={false}
    />,
  );
  const unmark = renderToStaticMarkup(
    <MgaPaymentStateDialog
      dialog={{
        item: {
          ...item,
          paidAt: "2026-07-10T12:00:00.000Z",
          status: "paid",
        },
        targetStatus: "unpaid",
      }}
      error="The payment change could not be completed. Try again."
      onCancel={() => {}}
      onSubmit={() => {}}
      pending={false}
    />,
  );
  const pending = renderToStaticMarkup(
    <MgaPaymentStateDialog
      dialog={{ item, targetStatus: "paid" }}
      error={null}
      onCancel={() => {}}
      onSubmit={() => {}}
      pending
    />,
  );

  assert.match(mark, /Payment reference \(optional\)/);
  assert.match(mark, new RegExp(`maxLength="${MAX_MGA_PAYMENT_REFERENCE_LENGTH}"`, "i"));
  assert.match(unmark, /Open pay-sheet placements for this policy will be removed/);
  assert.match(unmark, /Closed pay-sheet history will remain unchanged/);
  assert.match(unmark, /role="alert"/);
  assert.match(pending, /Saving\.\.\./);
  assert.match(pending, /disabled=""/);
});

function populatedFixture(): MgaPayableListResponse {
  const alphaUnpaid = payableItemFixture({
    approvedAt: "2026-05-01T12:00:00.000Z",
  });
  const alphaWarning = payableItemFixture({
    accountAssignment: "house",
    approvedAt: "2026-06-01T12:00:00.000Z",
    insuredName: "Beacon Bakery",
    kayleeSplit: "house",
    netDue: "225.01",
    overridden: false,
    policyId: uuid(11),
    policyNumber: "GL-101",
    producerDisplayName: "Kaylee",
    producerUserId: uuid(2),
  });
  const betaPaid = payableItemFixture({
    accountAssignment: "house",
    approvedAt: "2026-07-01T12:00:00.000Z",
    insuredName: "Cobalt Roofing",
    kayleeSplit: "none",
    mgaId: uuid(3),
    mgaName: "Beta MGA",
    netDue: "400.00",
    overridden: false,
    paidAt: "2026-07-10T12:00:00.000Z",
    paymentReference: "WIRE-400",
    policyId: uuid(12),
    policyNumber: "GL-102",
    producerDisplayName: null,
    producerUserId: null,
    status: "paid",
  });
  return {
    groups: [
      {
        items: [alphaUnpaid, alphaWarning],
        mgaId: alphaUnpaid.mgaId,
        mgaName: alphaUnpaid.mgaName,
        totals: totals("1075.01", "0.00", 0, 2, 2),
      },
      {
        items: [betaPaid],
        mgaId: betaPaid.mgaId,
        mgaName: betaPaid.mgaName,
        totals: totals("0.00", "400.00", 1, 1, 0),
      },
    ],
    status: "all",
    summary: totals("1075.01", "400.00", 1, 3, 2),
  };
}

function totals(
  outstandingAmount: string,
  paidAmount: string,
  paidCount: number,
  totalCount: number,
  unpaidCount: number,
) {
  return {
    outstandingAmount,
    paidAmount,
    paidCount,
    totalCount,
    unpaidCount,
  };
}

function renderView(
  data: MgaPayableListResponse,
  filter = data.status,
): string {
  return renderState({ data, status: "ready" }, filter);
}

function renderState(
  state: Parameters<typeof MgaPayablesView>[0]["state"],
  filter: Parameters<typeof MgaPayablesView>[0]["filter"] = "unpaid",
): string {
  return renderToStaticMarkup(
    <MgaPayablesView
      filter={filter}
      notice={null}
      now={NOW}
      onFilter={() => {}}
      onOpen={() => {}}
      onRetry={() => {}}
      pending={false}
      state={state}
    />,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
