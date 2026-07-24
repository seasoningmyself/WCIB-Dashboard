import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftResponse } from "../../../shared/drafts.js";
import { HelpRequests, HelpRequestsView, formatHelpRequestAge } from "./HelpRequests.js";

const DRAFT_ID = "00000000-0000-4000-8000-000000000801";
const MGA_ID = "00000000-0000-4000-8000-000000000802";

test("dedicated Help Requests renders v15 context and the shared resolution actions", () => {
  const markup = renderToStaticMarkup(
    <HelpRequestsView
      mgaNames={new Map([[MGA_ID, "Amwins"]])}
      notice={null}
      now={new Date("2026-07-17T15:00:00.000Z")}
      onOpen={() => {}}
      onOpenFix={() => {}}
      onRetry={() => {}}
      pending={false}
      state={{ items: [{ draft: flaggedDraft(), submitterDisplayName: "Mercedes" }], status: "ready" }}
    />,
  );

  for (const value of [
    "Review Queue",
    "Mercedes",
    "3 hours ago",
    "Need help with financing",
    "Flagged Insured",
    "HELP-100",
    "Amwins",
    "$1,000.00",
    "$400.00",
    "$50.00",
    "$225.00",
    "Open &amp; fix",
    "Push through",
    "Send back",
  ]) {
    assert.equal(markup.includes(value), true, value);
  }
});

test("dedicated Help Requests has bounded states and fails closed for staff roles", () => {
  assert.match(renderView({ status: "loading" }), /Loading Help Requests/);
  assert.match(renderView({ status: "error" }), /Try again/);
  assert.match(renderView({ items: [], status: "ready" }), /No help requests/);
  for (const role of ["employee", "producer"] as const) {
    const markup = renderToStaticMarkup(<HelpRequests user={user(role)} />);
    assert.match(markup, /Help Requests unavailable/);
    assert.doesNotMatch(markup, /Flagged Insured|Need help with financing/);
  }
});

test("help-request age formatting is deterministic and bounded", () => {
  const now = new Date("2026-07-17T15:00:00.000Z");
  assert.equal(formatHelpRequestAge("2026-07-17T14:59:30.000Z", now), "just now");
  assert.equal(formatHelpRequestAge("2026-07-17T14:15:00.000Z", now), "45 minutes ago");
  assert.equal(formatHelpRequestAge("2026-07-17T05:00:00.000Z", now), "10 hours ago");
  assert.equal(formatHelpRequestAge("2026-07-14T15:00:00.000Z", now), "3 days ago");
});

function renderView(state: React.ComponentProps<typeof HelpRequestsView>["state"]) {
  return renderToStaticMarkup(
    <HelpRequestsView
      mgaNames={new Map()}
      notice={null}
      onOpen={() => {}}
      onOpenFix={() => {}}
      onRetry={() => {}}
      pending={false}
      state={state}
    />,
  );
}

function flaggedDraft(): DraftResponse {
  const timestamp = "2026-07-17T12:00:00.000Z";
  return {
    accountAssignment: "book",
    agencyCommissionAmount: "125.00",
    amountPaid: "400.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: null,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: timestamp,
    depositOption: "0.00",
    effectiveDate: "2026-07-17",
    expirationDate: "2027-07-17",
    financeBalance: "750.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    flagReason: "Need help with financing",
    history: [],
    id: DRAFT_ID,
    insuredName: "Flagged Insured",
    invoiceNumber: null,
    ipfsFinanced: "no",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    lastEditedAt: timestamp,
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaFee: "25.00",
    mgaId: MGA_ID,
    netDue: "225.00",
    notes: null,
    officeLocationId: null,
    ownerUserId: "00000000-0000-4000-8000-000000000803",
    paymentMode: "full",
    policyNumber: "HELP-100",
    policyTypeId: null,
    producerUserId: null,
    proposalTotal: "1075.00",
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "flagged",
    submittedAt: null,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "New",
  };
}

function user(role: "employee" | "producer"): CurrentUser {
  return {
    allowedNavigation: ["turn_in", "my_items"],
    capabilities: [],
    displayName: "Staff",
    email: "staff@example.test",
    id: "00000000-0000-4000-8000-000000000804",
    passwordChangeRequired: false,
    role,
  };
}
