import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { MyCommissionsResponse } from "../../../shared/my-commissions.js";
import {
  MyCommissions,
  MyCommissionsView,
  type MyCommissionsState,
} from "./MyCommissions.js";
import { commissionItem, commissionsResponse, uuid } from "./test-fixture.js";

const PRODUCER: CurrentUser = {
  allowedNavigation: ["turn_in", "my_items", "my_commissions"],
  capabilities: [],
  displayName: "Kaylee",
  email: "kaylee@example.test",
  id: uuid(2),
  passwordChangeRequired: false,
  role: "producer",
};

const PROHIBITED_FIELDS = [
  "policyNumber",
  "effectiveDate",
  "expirationDate",
  "carrierId",
  "carrierName",
  "mgaId",
  "mgaName",
  "contacts",
  "basePremium",
  "taxes",
  "mgaFee",
  "brokerFee",
  "commissionAmount",
  "commissionRate",
  "commissionMode",
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
  "ipfsReturning",
  "ipfsManual",
  "ipfsPushed",
  "agencyRevenue",
  "agencyGross",
  "agencyTotal",
  "sophiaShare",
  "sophiaTakeHome",
  "rateSnapshot",
  "producerRate",
  "producerUserId",
  "producerDisplayName",
] as const;

test("producer view renders server totals, all sections, estimates, unavailable payout, and receipt actions", () => {
  const data = populatedFixture();
  const markup = renderReady(data);

  for (const visible of [
    "My Commissions",
    "Private to your account",
    "Owed to you",
    "$825.50",
    "Paid last 30 days",
    "$400.00",
    "In review",
    "Awaiting payment",
    "Acme Construction",
    "General Liability",
    "New Business",
    "Mark paid",
    "Beacon Bakery",
    "$275.00",
    "Estimate",
    "Awaiting admin review",
    "Cobalt Roofing",
    "Paid Jul 11, 2026",
    "Undo",
    "Delta Dental",
    "Unavailable",
  ]) {
    assert.match(markup, new RegExp(escapeRegExp(visible)));
  }
  assert.doesNotMatch(markup, /commission rate|personal rate|>Print<|>Export</i);
});

test("view never renders fields outside the exact H1 allowlist even if an unsafe object reaches it", () => {
  const data = populatedFixture();
  const unsafeItem: Record<string, unknown> = { ...data.items[0] };
  for (const field of PROHIBITED_FIELDS) {
    unsafeItem[field] = `SENSITIVE_${field}`;
  }
  data.items[0] = unsafeItem as never;

  const markup = renderReady(data);
  for (const field of PROHIBITED_FIELDS) {
    assert.doesNotMatch(markup, new RegExp(`SENSITIVE_${field}`));
  }
  assert.deepEqual(
    Object.keys(commissionItem()).sort(),
    [
      "estimate",
      "id",
      "insuredName",
      "payout",
      "policyType",
      "receivedAt",
      "section",
      "status",
      "transactionType",
    ],
  );
});

test("non-producers fail closed before mounting the API-backed commissions controller", () => {
  const users: CurrentUser[] = [
    { ...PRODUCER, allowedNavigation: ["turn_in", "my_items"] },
    { ...PRODUCER, allowedNavigation: ["my_commissions"], capabilities: ["admin"], role: "admin" as const },
    { ...PRODUCER, allowedNavigation: ["turn_in", "my_items"], role: "employee" as const },
  ];
  for (const user of users) {
    const markup = renderToStaticMarkup(<MyCommissions user={user} />);
    assert.match(markup, /My Commissions unavailable/);
    assert.doesNotMatch(markup, /Loading commissions|Owed to you|Acme Construction/);
  }
});

test("view exposes loading, denied, failure, blank, and searched-empty states", () => {
  assert.match(renderState({ status: "loading" }), /Loading commissions/);
  assert.match(renderState({ status: "denied" }), /My Commissions unavailable/);
  assert.match(renderState({ status: "error" }), /Try again/);

  const blank = commissionsResponse();
  blank.items = [];
  blank.summary = {
    inReviewCount: 0,
    owedAmount: "0.00",
    owedCount: 0,
    paidLast30DaysAmount: "0.00",
    paidLast30DaysCount: 0,
  };
  assert.match(renderReady(blank), /No commission activity yet/);
  const searched = renderReady(blank, "Acme");
  assert.match(searched, /No commissions match this search/);
  assert.match(searched, /aria-label="Clear commission search"/);
  assert.doesNotMatch(searched, /type="submit"/);
});

test("My Commissions search updates live and Escape clears it", () => {
  const source = readFileSync(
    new URL("./MyCommissions.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /onChange=\{\(event\) => onSearchChange\(event\.currentTarget\.value\)\}/,
  );
  assert.match(source, /event\.key === "Escape"[\s\S]*onSearchChange\(""\)/);
  assert.doesNotMatch(source, /submitSearch/);
});

test("print CSS suppresses commission rows and exposes only the confidentiality notice", () => {
  const markup = renderReady(populatedFixture());
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(markup, /my-commissions-print-notice/);
  assert.match(markup, /Confidential commission details/);
  assert.match(
    css,
    /@media print[\s\S]*\.my-commissions-screen-content\s*\{[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(
    css,
    /@media print[\s\S]*\.my-commissions-print-notice\s*\{[\s\S]*display:\s*block\s*!important/,
  );
});

function populatedFixture(): MyCommissionsResponse {
  return {
    items: [
      commissionItem(),
      commissionItem({
        estimate: true,
        id: uuid(2),
        insuredName: "Beacon Bakery",
        payout: "275.00",
        section: "in_review",
        status: "pending_approval",
        transactionType: "Renewal",
      }),
      commissionItem({
        id: uuid(3),
        insuredName: "Cobalt Roofing",
        payout: "400.00",
        receivedAt: "2026-07-11T12:00:00.000Z",
        section: "paid",
        status: "received",
      }),
      commissionItem({
        id: uuid(4),
        insuredName: "Delta Dental",
        payout: null,
      }),
    ],
    summary: {
      inReviewCount: 1,
      owedAmount: "825.50",
      owedCount: 2,
      paidLast30DaysAmount: "400.00",
      paidLast30DaysCount: 1,
    },
  };
}

function renderReady(data: MyCommissionsResponse, search = ""): string {
  return renderState({ data, status: "ready" }, search);
}

function renderState(state: MyCommissionsState, search = ""): string {
  return renderToStaticMarkup(
    <MyCommissionsView
      notice={null}
      onReceipt={() => {}}
      onRetry={() => {}}
      onSearchChange={() => {}}
      onSort={() => {}}
      pendingId={null}
      query={{ search, sort: "insured" }}
      search={search}
      state={state}
    />,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
