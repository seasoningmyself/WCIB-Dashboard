import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftResponse } from "../../../shared/drafts.js";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
import { VocabularyProvider } from "../vocabulary/context.js";
import {
  loadMyDraftsState,
  MyDraftsView,
  type MyDraftsState,
} from "./MyDrafts.js";

const DRAFT_ID = "00000000-0000-4000-8000-000000000301";
const OTHER_ID = "00000000-0000-4000-8000-000000000302";
const USER_ID = "00000000-0000-4000-8000-000000000303";

test("My Drafts lists only projected identifying fields and status actions", () => {
  const markup = renderView({
    currentPath: "/my-drafts",
    state: {
      drafts: [
        draft(),
        draft({ id: OTHER_ID, status: "sent_back" }),
        draft({ id: uuid(4), status: "submitted" }),
        draft({ id: uuid(5), status: "flagged" }),
        draft({ id: uuid(6), status: "approved" }),
      ],
      requests: [],
      status: "ready",
    },
  });

  assert.match(markup, /My Drafts/);
  assert.match(markup, /Acme LLC/);
  assert.match(markup, /WCIB-100/);
  assert.match(markup, />Edit</);
  assert.match(markup, />Review and reopen</);
  assert.match(markup, />Reopen and edit</);
  assert.match(markup, /View status/);
  assert.doesNotMatch(markup, /Base premium|Agency commission total|IPFS financing/);
  assert.doesNotMatch(markup, /ownerUserId|producerUserId/);
});

test("active producer draft editing renders agency inputs but no personal split", () => {
  const markup = renderView({
    currentPath: `/my-drafts?draft=${DRAFT_ID}`,
    state: {
      drafts: [draft({
        agencyCommissionAmount: "100.00",
        amountPaid: "500.00",
        basePremium: "1000.00",
        brokerFee: "50.00",
        commissionConfirmed: true,
        commissionMode: "pct",
        commissionRate: "10.0000",
        depositOption: "500.00",
        financeBalance: "600.00",
        ipfsFinanced: "yes",
        ipfsManual: true,
        mgaFee: "25.00",
        netDue: "350.00",
        paymentMode: "deposit",
        proposalTotal: "1100.00",
        taxes: "25.00",
      })],
      requests: [],
      status: "ready",
    },
  });

  assert.match(markup, /Premium detail — from carrier invoice &amp; binding docs/);
  assert.match(markup, /Agency commission total/);
  assert.match(markup, /IPFS financing/);
  assert.match(markup, /value="1000.00"/);
  assert.doesNotMatch(markup, /producer payout|personal split|producer rate/i);
});

test("sent-back editing exposes only nonfinancial fields until C3 reopens it", () => {
  const markup = renderView({
    currentPath: `/my-drafts?draft=${DRAFT_ID}`,
    state: {
      drafts: [draft({
        basePremium: "1000.00",
        financeContact: {
          address: "Private address",
          email: "private@example.test",
          mobile: "555-0100",
        },
        ipfsFinanced: "yes",
        sentBackAt: "2026-07-10T14:00:00.000Z",
        sentBackReason: "Correct the policy number.",
        status: "sent_back",
      })],
      requests: [],
      status: "ready",
    },
  });

  assert.match(markup, /Changes requested/);
  assert.match(markup, /Correct the policy number/);
  assert.match(markup, />Reopen draft</);
  assert.doesNotMatch(markup, /Submit for approval|Submit to ledger/);
  assert.doesNotMatch(markup, /Base premium|Agency commission total|IPFS financing/);
  assert.doesNotMatch(markup, /Private address|private@example\.test|555-0100/);
});

test("submitted status offers owner withdrawal without exposing financial fields", () => {
  const markup = renderView({
    currentPath: `/my-drafts?draft=${DRAFT_ID}`,
    state: {
      drafts: [draft({
        flagReason: null,
        status: "submitted",
        submittedAt: "2026-07-10T13:00:00.000Z",
      })],
      requests: [],
      status: "ready",
    },
  });

  assert.match(markup, /Back to My Drafts/);
  assert.match(markup, />Reopen and edit</);
  assert.doesNotMatch(markup, /Base premium|Broker fee|Agency commission|IPFS|Finance balance/);
});

test("approved status remains immutable and contains no financial placeholder", () => {
  const markup = renderView({
    currentPath: `/my-drafts?draft=${DRAFT_ID}`,
    state: {
      drafts: [draft({
        flagReason: null,
        status: "approved",
        submittedAt: "2026-07-10T13:00:00.000Z",
      })],
      requests: [],
      status: "ready",
    },
  });

  assert.match(markup, /Back to My Drafts/);
  assert.doesNotMatch(markup, />Edit<|Reopen draft|Submit for approval/);
  assert.doesNotMatch(markup, /Base premium|Broker fee|Agency commission|IPFS|Finance balance/);
});

test("approved owner can submit only a reason-only change request", () => {
  const linked = draft({
    linkedPolicyId: uuid(20),
    status: "approved",
    submittedAt: "2026-07-10T13:00:00.000Z",
  });
  const available = renderView({
    changeRequestDialog: {
      error: false,
      pending: false,
      policyId: uuid(20),
      reason: "Correct the insured name.",
    },
    currentPath: `/my-drafts?draft=${DRAFT_ID}`,
    state: { drafts: [linked], requests: [], status: "ready" },
  });
  assert.match(available, /Request a change/);
  assert.match(available, /Reason/);
  assert.match(available, /Correct the insured name/);
  assert.match(available, /does not change the approved policy/);
  assert.doesNotMatch(
    available,
    /Base premium|Broker fee|Agency commission|Net due|IPFS|Finance balance/,
  );

  const pending = renderView({
    currentPath: `/my-drafts?draft=${DRAFT_ID}`,
    state: {
      drafts: [linked],
      requests: [changeRequest({ policyId: uuid(20) })],
      status: "ready",
    },
  });
  assert.match(pending, /Pending review/);
  assert.match(pending, /Please review the approved record/);
  assert.doesNotMatch(pending, />Request a change</);
});

test("flagged owner view offers audited reopen without exposing stored financials", () => {
  const markup = renderView({
    currentPath: `/my-drafts?draft=${DRAFT_ID}`,
    state: {
      drafts: [draft({
        basePremium: undefined,
        flagReason: "Need carrier help.",
        status: "flagged",
      })],
      requests: [],
      status: "ready",
    },
  });

  assert.match(markup, /Need carrier help/);
  assert.match(markup, />Reopen and edit</);
  assert.doesNotMatch(markup, /Base premium|Broker fee|Agency commission|IPFS|Finance balance/);
});

test("another-owner URL guess and list failures disclose no draft data", () => {
  const guessed = renderView({
    currentPath: `/my-drafts?draft=${OTHER_ID}`,
    state: { drafts: [draft()], requests: [], status: "ready" },
  });
  assert.match(guessed, /Draft not available/);
  assert.doesNotMatch(guessed, /Acme LLC|WCIB-100/);

  const loading = renderView({ currentPath: "/my-drafts", state: { status: "loading" } });
  const error = renderView({ currentPath: "/my-drafts", state: { status: "error" } });
  const empty = renderView({
    currentPath: "/my-drafts",
    state: { drafts: [], requests: [], status: "ready" },
  });
  assert.match(loading, /Loading drafts/);
  assert.match(error, /Drafts unavailable/);
  assert.match(empty, /No saved turn-ins/);
});

test("admin draft loading skips the staff-only change-request endpoint", async () => {
  const calls: string[] = [];
  const api = {
    async list() {
      calls.push("drafts");
      return { drafts: [draft()] };
    },
    async listChangeRequests() {
      calls.push("change-requests");
      return { requests: [changeRequest()] };
    },
  };

  const adminState = await loadMyDraftsState(api, "admin");
  assert.deepEqual(calls, ["drafts"]);
  assert.deepEqual(adminState.requests, []);

  calls.length = 0;
  const producerState = await loadMyDraftsState(api, "producer");
  assert.deepEqual(calls, ["drafts", "change-requests"]);
  assert.equal(producerState.requests.length, 1);
});

function renderView({
  changeRequestDialog,
  currentPath,
  state,
}: {
  changeRequestDialog?: Parameters<typeof MyDraftsView>[0]["changeRequestDialog"];
  currentPath: string;
  state: MyDraftsState;
}): string {
  return renderToStaticMarkup(
    <ApiClientProvider
      boundary={createSessionBoundary(() => {})}
      client={{ async request() { return Response.json({}); } }}
    >
      <VocabularyProvider>
        <MyDraftsView
          changeRequestDialog={changeRequestDialog}
          currentPath={currentPath}
          onDraftChange={() => {}}
          onRetry={() => {}}
          onWithdraw={() => {}}
          state={state}
          user={producer()}
          withdrawal={null}
        />
      </VocabularyProvider>
    </ApiClientProvider>,
  );
}

function changeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(21),
    policyId: uuid(20),
    reason: "Please review the approved record.",
    requestedAt: "2026-07-14T12:00:00.000Z",
    resolution: null,
    resolutionReason: null,
    resolvedAt: null,
    status: "pending" as const,
    ...overrides,
  };
}

function producer(): CurrentUser {
  return {
    allowedNavigation: ["turn_in", "my_items", "my_commissions"],
    capabilities: [],
    displayName: "Kaylee",
    email: "kaylee@example.test",
    id: USER_ID,
    passwordChangeRequired: false,
    role: "producer",
  };
}

function draft(overrides: Partial<DraftResponse> = {}): DraftResponse {
  return {
    accountAssignment: "book",
    carrierId: null,
    companyName: "Acme Incorporated",
    createdAt: "2026-07-10T12:00:00.000Z",
    effectiveDate: "2026-07-10",
    expirationDate: "2027-07-10",
    flagReason: null,
    history: [],
    id: DRAFT_ID,
    insuredName: "Acme LLC",
    invoiceNumber: null,
    lastEditedAt: "2026-07-10T12:00:00.000Z",
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaId: null,
    notes: null,
    officeLocationId: null,
    ownerUserId: USER_ID,
    policyNumber: "WCIB-100",
    policyTypeId: null,
    producerUserId: USER_ID,
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "draft",
    submittedAt: null,
    transactionNotes: null,
    transactionType: "New",
    ...overrides,
  };
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
