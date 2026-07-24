import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { MyItemsResponse } from "../../../shared/my-items.js";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
import {
  MyItems,
  MyItemsView,
  type MyItemsState,
} from "./MyItems.js";
import { myItem, uuid } from "./test-fixture.js";

const EMPLOYEE: CurrentUser = {
  allowedNavigation: ["turn_in", "my_items"],
  capabilities: [],
  displayName: "Mercedes",
  email: "mercedes@example.test",
  id: uuid(9),
  passwordChangeRequired: false,
  role: "employee",
};

const PROHIBITED_FIELDS = [
  "basePremium",
  "taxes",
  "mgaFee",
  "brokerFee",
  "commissionMode",
  "commissionRate",
  "commissionAmount",
  "agencyCommissionAmount",
  "producerPayout",
  "amountPaid",
  "proposalTotal",
  "netDue",
  "paymentMode",
  "depositOption",
  "financeBalance",
  "financeReference",
  "financeContact",
  "financeMeta",
  "ipfsFinanced",
  "ipfsManual",
  "ipfsReturning",
  "ipfsPushed",
  "ownerUserId",
  "producerUserId",
] as const;

test("My Items renders v15 identifiers, age, reasons, and all status links", () => {
  const markup = renderReady(populatedFixture());
  for (const visible of [
    "My Items",
    "Drafts",
    "Submitted",
    "Waiting on Sophia",
    "Sent back",
    "Approved",
    "Acme Construction",
    "POL-1001",
    "Summit MGA",
    "Continue draft",
    "Beacon Bakery",
    "View submission",
    "Cobalt Roofing",
    "View help request",
    "Help request",
    "Confirm the account assignment",
    "Delta Dental",
    "Review changes",
    "Changes requested",
    "Correct the carrier selection",
    "View approved item",
  ]) {
    assert.match(markup, new RegExp(escapeRegExp(visible)));
  }
  assert.match(markup, /class="my-items-new"/);
  assert.equal((markup.match(/href="#\/my-drafts\?draft=/g) ?? []).length, 5);
});

test("My Items never renders richer draft fields even if an unsafe object reaches the view", () => {
  const data = populatedFixture();
  const unsafe: Record<string, unknown> = { ...data.items[0] };
  for (const field of PROHIBITED_FIELDS) {
    unsafe[field] = `SENSITIVE_${field}`;
  }
  data.items[0] = unsafe as never;
  const markup = renderReady(data);
  for (const field of PROHIBITED_FIELDS) {
    assert.doesNotMatch(markup, new RegExp(`SENSITIVE_${field}`));
  }
  assert.deepEqual(Object.keys(myItem()), [
    "id",
    "lastActivityAt",
    "mgaName",
    "policyNumber",
    "reason",
    "status",
    "submittedAt",
    "title",
  ]);
});

test("My Items supports filters, loading, denied, error, empty, and filtered-empty states", () => {
  assert.match(renderState({ status: "loading" }), /Loading My Items/);
  assert.match(renderState({ status: "denied" }), /My Items unavailable/);
  assert.match(renderState({ status: "error" }), /Try again/);
  assert.match(renderReady({ items: [] }), /No turn-ins yet/);
  assert.match(renderReady(populatedFixture(), "approved"), /Echo Electric/);
  assert.doesNotMatch(renderReady(populatedFixture(), "approved"), /Acme Construction/);
  assert.match(renderReady(populatedFixture(), "submitted"), /Beacon Bakery/);

  const noApproved = populatedFixture();
  noApproved.items = noApproved.items.filter(({ status }) => status !== "approved");
  assert.match(renderReady(noApproved, "approved"), /No approved turn-ins/);
});

test("My Items fails closed before mounting for unsupported or unauthorized principals", () => {
  const deniedUsers: CurrentUser[] = [
    { ...EMPLOYEE, role: "admin" as const },
    { ...EMPLOYEE, role: null },
    { ...EMPLOYEE, allowedNavigation: ["turn_in"] },
  ];
  for (const user of deniedUsers) {
    const markup = renderToStaticMarkup(<MyItems user={user} />);
    assert.match(markup, /My Items unavailable/);
    assert.doesNotMatch(markup, /Loading My Items|Acme Construction/);
  }
  const producer = { ...EMPLOYEE, role: "producer" as const };
  assert.match(
    renderToStaticMarkup(
      <ApiClientProvider
        boundary={createSessionBoundary(() => {})}
        client={{ async request() { return Response.json({ items: [] }); } }}
      >
        <MyItems user={producer} />
      </ApiClientProvider>,
    ),
    /Loading My Items/,
  );
});

function populatedFixture(): MyItemsResponse {
  return {
    items: [
      myItem(),
      myItem({
        id: uuid(2),
        status: "submitted",
        submittedAt: "2026-07-10T12:00:00.000Z",
        title: "Beacon Bakery",
      }),
      myItem({
        id: uuid(3),
        reason: "Confirm the account assignment",
        status: "flagged",
        title: "Cobalt Roofing",
      }),
      myItem({
        id: uuid(4),
        reason: "Correct the carrier selection",
        status: "sent_back",
        submittedAt: "2026-07-09T12:00:00.000Z",
        title: "Delta Dental",
      }),
      myItem({
        id: uuid(5),
        status: "approved",
        submittedAt: "2026-07-08T12:00:00.000Z",
        title: "Echo Electric",
      }),
    ],
  };
}

function renderReady(
  data: MyItemsResponse,
  filter: Parameters<typeof MyItemsView>[0]["filter"] = "all",
): string {
  return renderState({ data, status: "ready" }, filter);
}

function renderState(
  state: MyItemsState,
  filter: Parameters<typeof MyItemsView>[0]["filter"] = "all",
): string {
  return renderToStaticMarkup(
    <MyItemsView
      filter={filter}
      onFilter={() => {}}
      onRetry={() => {}}
      state={state}
    />,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
