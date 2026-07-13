import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  PaySheetAdjustmentDialog,
  PaySheetCloseDialog,
} from "./PaySheetDialogs.js";
import {
  PaySheetBootstrap,
  PaySheets,
  PaySheetsView,
} from "./PaySheets.js";
import {
  paySheetDetailFixture,
  paySheetListFixture,
  producerSummaryFixture,
  sophiaSummaryFixture,
  uuid,
} from "./test-fixture.js";

test("admin view renders owner tabs, exact totals, policy detail, and frozen history", () => {
  const data = paySheetListFixture();
  const sophiaOpen = data.items[0]!;
  const sophiaClosed = data.items[1]!;
  const markup = renderView({
    data,
    details: {
      [sophiaOpen.id]: {
        data: paySheetDetailFixture(sophiaOpen),
        status: "ready",
      },
      [sophiaClosed.id]: {
        data: paySheetDetailFixture(sophiaClosed),
        status: "ready",
      },
    },
    expandedClosedId: sophiaClosed.id,
    selectedOwnerKey: `sophia:${uuid(1)}`,
  });

  for (const visible of [
    "Pay Sheets",
    "Sophia",
    "Kaylee",
    "Current period",
    "July 2026",
    "Agency gross",
    "$250.00",
    "Broker fees",
    "$50.00",
    "Commissions",
    "$100.00",
    "Trust pull",
    "$150.00",
    "Direct income",
    "Grand total income",
    "Sophia take-home",
    "$212.50",
    "Sophia share",
    "$112.50",
    "Acme Construction",
    "GL-100",
    "General Liability",
    "Direct-pay client",
    "Check income",
    "Close sheet",
    "Add correction",
    "Add direct income",
    "Closed history",
    "June 2026",
    "Frozen history",
  ]) {
    assert.match(markup, new RegExp(escapeRegExp(visible)));
  }
  for (const [label, value] of [
    ["Broker fees", "$50.00"],
    ["Commissions", "$100.00"],
    ["Trust pull", "$150.00"],
    ["Direct income", "$100.00"],
    ["Grand total income", "$250.00"],
    ["Agency gross", "$250.00"],
    ["Sophia take-home", "$212.50"],
  ]) {
    assert.match(
      markup,
      new RegExp(`<dt>${escapeRegExp(label)}</dt><dd>${escapeRegExp(value)}</dd>`),
    );
  }
  assert.notEqual(markup.indexOf("Agency gross"), markup.indexOf("Sophia take-home"));
  const frozenSection = markup.slice(markup.lastIndexOf("June 2026"));
  for (const forbidden of ["Close sheet", "Add correction", "Add direct income", ">Edit<", ">Delete<"]) {
    assert.doesNotMatch(frozenSection, new RegExp(forbidden));
  }
  for (const forbidden of ["Reopen", "localStorage"]) {
    assert.doesNotMatch(markup, new RegExp(forbidden, "i"));
  }
});

test("producer view renders payout and rate context without Sophia controls", () => {
  const producer = producerSummaryFixture();
  const data = {
    ...paySheetListFixture(),
    items: [producer],
  };
  const markup = renderView({
    data,
    details: {
      [producer.id]: {
        data: paySheetDetailFixture(producer),
        status: "ready",
      },
    },
    selectedOwnerKey: `producer:${uuid(2)}`,
  });

  for (const visible of [
    "Producer payout",
    "$45.00",
    "Broker fees",
    "Commissions",
    "Trust pull",
    "Direct income",
    "Grand total income",
    "Current payout rate",
    "New commission",
    "25.00%",
    "Renewal broker",
    "30.00%",
    "Add correction",
  ]) {
    assert.match(markup, new RegExp(escapeRegExp(visible)));
  }
  for (const [label, value] of [
    ["Broker fees", "$50.00"],
    ["Commissions", "$100.00"],
    ["Trust pull", "$150.00"],
    ["Direct income", "$0.00"],
    ["Grand total income", "$150.00"],
  ]) {
    assert.match(
      markup,
      new RegExp(`<dt>${escapeRegExp(label)}</dt><dd>${escapeRegExp(value)}</dd>`),
    );
  }
  assert.doesNotMatch(markup, /Add direct income|Sophia take-home|Agency gross/);
});

test("screen exposes loading, failure, denied, empty, and detail retry states", () => {
  assert.match(renderState({ status: "loading" }), /Loading pay sheets/);
  assert.match(renderState({ status: "error" }), /Try again/);
  assert.match(renderState({ status: "denied" }), /Pay sheets unavailable/);
  assert.match(
    renderState({
      data: { ...paySheetListFixture(), items: [] },
      status: "ready",
    }),
    /Start pay sheets/,
  );

  const data = paySheetListFixture();
  const open = data.items[0]!;
  const markup = renderView({
    data,
    details: { [open.id]: { status: "error" } },
    selectedOwnerKey: `sophia:${uuid(1)}`,
  });
  assert.match(markup, /Retry detail/);
  assert.doesNotMatch(markup, /Acme Construction|Direct-pay client/);
});

test("blank-state bootstrap defaults to June 2026 and remains editable", () => {
  const calls: unknown[] = [];
  const markup = renderToStaticMarkup(
    <PaySheetBootstrap
      disabled={false}
      error={null}
      onChange={(period) => calls.push(period)}
      onSubmit={() => calls.push("submit")}
      period={{ periodMonth: 6, periodYear: 2026 }}
    />,
  );
  assert.match(markup, /Start pay sheets/);
  assert.match(markup, /<option value="6" selected="">June<\/option>/);
  assert.match(markup, /value="2026"/);
  assert.match(markup, /Starting month/);
  assert.match(markup, /Starting year/);
  assert.doesNotMatch(markup, /disabled=""/);
  assert.deepEqual(calls, []);
});

test("non-admin entry fails closed before mounting the API-backed controller", () => {
  for (const role of ["employee", "producer"] as const) {
    const user: CurrentUser = {
      allowedNavigation:
        role === "producer"
          ? ["turn_in", "my_items", "my_commissions"]
          : ["turn_in", "my_items"],
      capabilities: [],
      displayName: "Private Staff",
      email: `${role}@example.test`,
      id: uuid(role === "employee" ? 91 : 92),
      role,
    };
    const markup = renderToStaticMarkup(<PaySheets user={user} />);
    assert.match(markup, /Pay sheets unavailable/);
    assert.doesNotMatch(
      markup,
      /Loading pay sheets|Agency gross|Producer payout|Export &amp; print|Excel/,
    );
  }
});

test("close confirmation states immutability and disables duplicate submission", () => {
  const sheet = sophiaSummaryFixture();
  const ready = renderToStaticMarkup(
    <PaySheetCloseDialog
      error={null}
      onCancel={() => {}}
      onConfirm={() => {}}
      pending={false}
      sheet={sheet}
    />,
  );
  const pending = renderToStaticMarkup(
    <PaySheetCloseDialog
      error="The sheet could not be closed. Try again."
      onCancel={() => {}}
      onConfirm={() => {}}
      pending
      sheet={sheet}
    />,
  );
  assert.match(ready, /cannot be reopened/);
  assert.match(ready, /later corrections belong on the next open sheet/);
  assert.match(pending, /Closing.../);
  assert.match(pending, /disabled=""/);
  assert.match(pending, /role="alert"/);
});

test("adjustment dialogs render only owner-valid financial controls", () => {
  const sophia = paySheetDetailFixture(sophiaSummaryFixture());
  const producer = paySheetDetailFixture(producerSummaryFixture());
  const policyTypes = [
    { classTag: "Commercial" as const, id: uuid(50), name: "General Liability" },
  ];
  const producers = [
    { displayName: "Kaylee", role: "producer" as const, userId: uuid(2) },
  ];
  const direct = renderToStaticMarkup(
    <PaySheetAdjustmentDialog
      dialog={{ kind: "create", mode: "direct_income", sheet: sophia }}
      error={null}
      onCancel={() => {}}
      onDelete={() => {}}
      onSubmit={() => {}}
      pending={false}
      policyTypes={policyTypes}
      producers={producers}
    />,
  );
  const producerCorrection = renderToStaticMarkup(
    <PaySheetAdjustmentDialog
      dialog={{ kind: "create", mode: "correction", sheet: producer }}
      error={null}
      onCancel={() => {}}
      onDelete={() => {}}
      onSubmit={() => {}}
      pending={false}
      policyTypes={policyTypes}
      producers={producers}
    />,
  );
  const deletion = renderToStaticMarkup(
    <PaySheetAdjustmentDialog
      dialog={{ adjustment: sophia.adjustments[0]!, kind: "delete", sheet: sophia }}
      error={null}
      onCancel={() => {}}
      onDelete={() => {}}
      onSubmit={() => {}}
      pending={false}
      policyTypes={policyTypes}
      producers={producers}
    />,
  );

  assert.match(direct, /Income amount/);
  assert.match(direct, /Check income/);
  assert.doesNotMatch(direct, /Payout delta|Broker fee delta|Commission delta|Policy type/);
  assert.match(producerCorrection, /Payout delta \(negative\)/);
  assert.match(producerCorrection, /Producer account/);
  assert.doesNotMatch(producerCorrection, /Broker fee delta|Commission delta|Add direct income/);
  assert.match(deletion, /Delete adjustment/);
  assert.match(deletion, /Direct-pay client/);
});

function renderView({
  data,
  details,
  expandedClosedId = null,
  selectedOwnerKey,
}: {
  data: PaySheetListResponseType;
  details: Parameters<typeof PaySheetsView>[0]["details"];
  expandedClosedId?: string | null;
  selectedOwnerKey: string;
}): string {
  return renderToStaticMarkup(
    <PaySheetsView
      bootstrap={{
        error: null,
        period: { periodMonth: 6, periodYear: 2026 },
      }}
      details={details}
      expandedClosedId={expandedClosedId}
      notice={null}
      onBootstrap={() => {}}
      onBootstrapChange={() => {}}
      onClose={() => {}}
      onOpenAdjustment={() => {}}
      onOwner={() => {}}
      onRetry={() => {}}
      onRetryDetail={() => {}}
      onToggleClosed={() => {}}
      pending={false}
      selectedOwnerKey={selectedOwnerKey}
      state={{ data, status: "ready" }}
    />,
  );
}

type PaySheetListResponseType = ReturnType<typeof paySheetListFixture>;

function renderState(
  state: Parameters<typeof PaySheetsView>[0]["state"],
): string {
  return renderToStaticMarkup(
    <PaySheetsView
      bootstrap={{
        error: null,
        period: { periodMonth: 6, periodYear: 2026 },
      }}
      details={{}}
      expandedClosedId={null}
      notice={null}
      onBootstrap={() => {}}
      onBootstrapChange={() => {}}
      onClose={() => {}}
      onOpenAdjustment={() => {}}
      onOwner={() => {}}
      onRetry={() => {}}
      onRetryDetail={() => {}}
      onToggleClosed={() => {}}
      pending={false}
      selectedOwnerKey={null}
      state={state}
    />,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
