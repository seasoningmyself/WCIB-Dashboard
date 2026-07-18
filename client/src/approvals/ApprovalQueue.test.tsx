import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApprovalWorkListResponse } from "../../../shared/approval-queue.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftResponse } from "../../../shared/drafts.js";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
import { VocabularyProvider } from "../vocabulary/context.js";
import {
  ApprovalDialogs,
  appendSendBackReason,
} from "./ApprovalDialogs.js";
import {
  ApprovalWorkDeletionDialogView,
  DeletedApprovalWorkPanel,
} from "./ApprovalWorkDeletionDialogs.js";
import { PolicyChangeRequestDialogs } from "./PolicyChangeRequestDialogs.js";
import {
  ApprovalQueue,
  ApprovalQueueView,
  type ApprovalQueueState,
} from "./ApprovalQueue.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000701";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000702";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000703";
const QUEUE_ID = "00000000-0000-4000-8000-000000000704";
const DRAFT_ID = "00000000-0000-4000-8000-000000000705";
const CHANGE_REQUEST_ID = "00000000-0000-4000-8000-000000000706";
const POLICY_ID = "00000000-0000-4000-8000-000000000707";

test("admin queue renders every financial review group and live resolution action", () => {
  const markup = renderView({
    deleted: deletedApprovalWork(),
    status: "ready",
    work: approvalWork(),
  });

  for (const label of [
    "Pending submissions",
    "Help requests",
    "Approved-policy change requests",
    "Base premium",
    "Agency commission",
    "Net due to MGA",
    "Payment and financing",
    "IPFS financed",
    "Finance contact",
    "Assignment classification",
  ]) {
    assert.match(markup, new RegExp(label));
  }
  for (const action of [
    "Select all",
    "Approve selected \\(0\\)",
    "Expand all",
    "Approve",
    "Approve with override",
    "Open &amp; fix",
    "Push through as-is",
    "Send back",
    "Delete",
  ]) {
    assert.match(markup, new RegExp(`>${action}<`));
  }
  assert.match(markup, /\$1,000\.00/);
  assert.match(markup, /finance@example\.test/);
  assert.match(markup, /Need admin help with financing/);
  assert.match(markup, /Correct the approved insured name/);
  assert.doesNotMatch(markup, /read-only|localStorage|owner withdrawal/i);
});

test("approval queue has bounded loading, error, empty, and denied states", () => {
  assert.match(renderView({ status: "loading" }), /Loading approvals/);
  assert.match(renderView({ status: "error" }), /Try again/);
  assert.match(renderView({ status: "denied" }), /Approvals unavailable/);
  assert.match(
    renderView({
      deleted: { items: [] },
      status: "ready",
      work: { changeRequests: [], helpRequests: [], submissions: [] },
    }),
    /Queue clear/,
  );
});

test("priority groups non-house work first and shows only complete-review badges", () => {
  const work = approvalWork();
  const source = work.submissions[0]!;
  const standard = {
    ...source,
    entry: {
      ...source.entry,
      id: uuid(21),
      submittedPayload: {
        ...source.entry.submittedPayload,
        accountAssignment: "none",
        insuredName: "Standard House",
        producerUserId: null,
      },
    },
  };
  const firstYear = {
    ...source,
    entry: {
      ...source.entry,
      id: uuid(22),
      submittedPayload: {
        ...source.entry.submittedPayload,
        accountAssignment: "house",
        insuredName: "First Year",
      },
    },
  };
  const selfAssigned = {
    ...source,
    entry: {
      ...source.entry,
      id: uuid(23),
      submittedByUserId: PRODUCER_ID,
      submittedPayload: {
        ...source.entry.submittedPayload,
        insuredName: "Self Assigned",
      },
    },
  };
  const markup = renderView({
    deleted: { items: [] },
    status: "ready",
    work: { ...work, submissions: [standard, selfAssigned, firstYear] },
  });

  assert.ok(markup.indexOf("Self Assigned") < markup.indexOf("Standard House"));
  assert.ok(markup.indexOf("First Year") < markup.indexOf("Standard House"));
  assert.match(markup, /Needs verification - non-house assignments/);
  assert.match(markup, /House account - standard/);
  assert.match(markup, /1st-year - verify/);
  assert.match(markup, /Producer self-assigned - verify/);
});

test("approval deletion UI requires a reason and exposes recoverable restore", () => {
  const work = approvalWork();
  const deleteDialog = renderToStaticMarkup(
    <ApprovalWorkDeletionDialogView
      dialog={{ item: work.submissions[0]!, kind: "delete_submission" }}
      onCancel={() => {}}
      onDelete={() => {}}
      onRestore={() => {}}
      pending={false}
    />,
  );
  assert.match(deleteDialog, /Move this non-approved item/);
  assert.match(deleteDialog, /maxLength="500"/);
  assert.match(deleteDialog, />Delete</);

  const panel = renderToStaticMarkup(
    <DeletedApprovalWorkPanel
      data={deletedApprovalWork()}
      onClose={() => {}}
      onRestore={() => {}}
      open
      pending={false}
    />,
  );
  assert.match(panel, /Deleted approval work/);
  assert.match(panel, /Recoverable reason/);
  assert.match(panel, />Restore</);
});

test("non-admin component fails closed before API or queue rendering", () => {
  const producerMarkup = renderToStaticMarkup(
    <ApprovalQueue user={producer()} />,
  );
  const employeeMarkup = renderToStaticMarkup(
    <ApprovalQueue user={{ ...producer(), role: "employee" }} />,
  );
  for (const markup of [producerMarkup, employeeMarkup]) {
    assert.match(markup, /Approvals unavailable/);
    assert.doesNotMatch(markup, /Private Submitted LLC|Need admin help/);
  }
});

test("dialogs expose bounded confirmation, reason, override, and full fix forms", () => {
  const work = approvalWork();
  const submission = work.submissions[0]!;
  const help = work.helpRequests[0]!;
  const common = {
    onApprove() {},
    onBulkApprove() {},
    onCancel() {},
    onEditFix() {},
    onOpenFix() {},
    onOverride() {},
    onPushThrough() {},
    onSendBack() {},
    pending: false,
    user: admin(),
  };
  const assignmentOptions = [
    { displayName: "Kaylee", userId: PRODUCER_ID },
  ];

  const approve = renderToStaticMarkup(
    <ApprovalDialogs dialog={{ item: submission, kind: "approve" }} {...common} />,
  );
  const bulkApprove = renderToStaticMarkup(
    <ApprovalDialogs
      dialog={{ items: [submission], kind: "bulk_approve" }}
      {...common}
    />,
  );
  const override = renderToStaticMarkup(
    <ApprovalDialogs dialog={{ item: submission, kind: "override" }} {...common} />,
  );
  const sendBack = renderToStaticMarkup(
    <ApprovalDialogs
      dialog={{ item: help, kind: "send_back_help" }}
      {...common}
    />,
  );
  const openFix = renderToStaticMarkup(
    withProviders(
      <ApprovalDialogs
        dialog={{ assignmentOptions, item: help, kind: "open_fix" }}
        {...common}
      />,
    ),
  );
  const editFix = renderToStaticMarkup(
    withProviders(
      <ApprovalDialogs
        dialog={{
          assignmentOptions,
          item: submission,
          kind: "edit_fix_submission",
        }}
        {...common}
      />,
    ),
  );

  assert.match(approve, /Approve to ledger/);
  assert.match(bulkApprove, /same guarded approval path/);
  assert.match(bulkApprove, /Approve selected \(1\)/);
  assert.match(override, /Commission amount|Broker fee|Net due to MGA/);
  assert.match(override, /Reason/);
  assert.match(sendBack, /maxLength="500"/);
  for (const label of [
    "Broker fee mismatch",
    "Policy # issue",
    "Wrong carrier/MGA",
    "Commission off",
    "Missing document",
  ]) {
    assert.match(sendBack, new RegExp(label.replace("/", "\\/")));
  }
  for (const label of [
    "Insured",
    "Policy number",
    "Carrier",
    "Base premium",
    "Commission mode",
    "Payment mode",
    "IPFS financed",
    "Finance email",
    "Approve corrected policy",
  ]) {
    assert.match(openFix, new RegExp(label));
  }
  assert.match(openFix, /role="dialog"/);
  assert.match(openFix, /aria-modal="true"/);
  assert.match(openFix, /1st-yr house - Kaylee/);
  assert.match(editFix, /Open and fix Private Submitted LLC/);
  assert.match(editFix, /Kaylee&#x27;s account/);
  assert.match(editFix, /1st-yr house - Kaylee/);
});

test("quick send-back reasons append with v15 punctuation behavior", () => {
  assert.equal(
    appendSendBackReason("", "Wrong or missing policy number"),
    "Wrong or missing policy number",
  );
  assert.equal(
    appendSendBackReason(
      "Check the invoice...  ",
      "Commission amount looks incorrect",
    ),
    "Check the invoice. Commission amount looks incorrect",
  );
});

test("approved-policy change dialogs expose only the three safe admin resolutions", () => {
  const item = approvalWork().changeRequests[0]!;
  const common = {
    onCancel() {},
    onChooseCorrection() {},
    onCorrect() {},
    onResolveAsIs() {},
    onSendBack() {},
    pending: false,
  };
  const choose = renderToStaticMarkup(
    <PolicyChangeRequestDialogs
      dialog={{
        assignmentOptions: [],
        item,
        kind: "change_request_fix_choice",
        policy: {} as never,
      }}
      {...common}
    />,
  );
  const asIs = renderToStaticMarkup(
    <PolicyChangeRequestDialogs
      dialog={{ item, kind: "change_request_as_is" }}
      {...common}
    />,
  );
  const sendBack = renderToStaticMarkup(
    <PolicyChangeRequestDialogs
      dialog={{ item, kind: "change_request_send_back" }}
      {...common}
    />,
  );

  assert.match(choose, /Correct policy details/);
  assert.match(choose, /Apply financial override/);
  assert.match(choose, /original ledger policy/);
  assert.match(asIs, /without changing the approved policy/);
  assert.match(asIs, /Push through as-is/);
  assert.match(sendBack, /maxLength="500"/);
  assert.doesNotMatch(sendBack, /Base premium|Commission|Net due|IPFS/);
});

function renderView(state: ApprovalQueueState): string {
  return renderToStaticMarkup(
    <ApprovalQueueView
      bulkResults={[]}
      expandedSubmissionIds={new Set()}
      filter="all"
      lookups={{}}
      notice={null}
      onApproveSelected={() => {}}
      onDeleteHelp={() => {}}
      onDeleteSubmission={() => {}}
      onExpandSubmission={() => {}}
      onExpandSubmissions={() => {}}
      onFilter={() => {}}
      onInlineApprove={() => {}}
      onOpenHelpFix={() => {}}
      onOpen={() => {}}
      onOpenChangeFix={() => {}}
      onOpenDeleted={() => {}}
      onOpenSubmissionFix={() => {}}
      onRetry={() => {}}
      onSelectSubmission={() => {}}
      onSelectSubmissions={() => {}}
      pending={false}
      selectedSubmissionIds={new Set()}
      state={state}
    />,
  );
}

function deletedApprovalWork() {
  const work = approvalWork();
  return {
    items: [
      {
        deletion: {
          deletedAt: "2026-07-12T12:00:00.000Z",
          deletedByUserId: ADMIN_ID,
          reason: "Recoverable reason",
        },
        entry: work.submissions[0]!.entry,
        kind: "submission" as const,
        submitterDisplayName: "Mercedes",
      },
    ],
  };
}

function withProviders(children: React.ReactNode) {
  return (
    <ApiClientProvider
      boundary={createSessionBoundary(() => {})}
      client={{ async request() { return Response.json({}); } }}
    >
      <VocabularyProvider>{children}</VocabularyProvider>
    </ApiClientProvider>
  );
}

function approvalWork(): ApprovalWorkListResponse {
  const timestamp = "2026-07-11T12:00:00.000Z";
  return {
    changeRequests: [changeRequest()],
    submissions: [
      {
        entry: {
          actedAt: null,
          actedByUserId: null,
          createdAt: timestamp,
          draftId: DRAFT_ID,
          id: QUEUE_ID,
          reason: null,
          status: "pending",
          submittedAt: timestamp,
          submittedByUserId: EMPLOYEE_ID,
          submittedPayload: submittedPayload(),
          updatedAt: timestamp,
        },
        submitterDisplayName: "Mercedes",
      },
    ],
    helpRequests: [
      {
        draft: draft(),
        submitterDisplayName: "Kaylee",
      },
    ],
  };
}

function changeRequest(): ApprovalWorkListResponse["changeRequests"][number] {
  const timestamp = "2026-07-14T12:00:00.000Z";
  return {
    insuredName: "Approved Insured LLC",
    policyNumber: "WCIB-CHANGE-1",
    requesterDisplayName: "Mercedes",
    request: {
      id: CHANGE_REQUEST_ID,
      mutationId: null,
      mutationKind: null,
      policyId: POLICY_ID,
      reason: "Correct the approved insured name.",
      requestedAt: timestamp,
      requestedByUserId: EMPLOYEE_ID,
      resolution: null,
      resolutionReason: null,
      resolvedAt: null,
      resolvedByUserId: null,
      status: "pending",
    },
  };
}

function submittedPayload() {
  return {
    accountAssignment: "book",
    amountPaid: "250.00",
    basePremium: "1000.00",
    brokerFee: "20.00",
    carrierId: uuid(11),
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: "Private Submitted LLC",
    depositOption: "250.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "780.00",
    financeContact: {
      address: "100 Main Street",
      email: "finance@example.test",
      mobile: "555-0100",
    },
    financeMeta: {
      billingType: "invoice",
      loanType: "commercial",
      minEarnedAmt: null,
      minEarnedPct: null,
    },
    financeReference: "FIN-1",
    insuredName: "Private Submitted LLC",
    invoiceNumber: null,
    ipfsFinanced: "yes",
    ipfsManual: false,
    ipfsReturning: "new",
    kayleeSplit: "book",
    mgaFee: "10.00",
    mgaId: uuid(12),
    netDue: "105.00",
    notes: "Private notes",
    officeLocationId: uuid(13),
    paymentMode: "deposit",
    policyNumber: "WCIB-700",
    policyTypeId: uuid(14),
    producerUserId: PRODUCER_ID,
    proposalTotal: "1030.00",
    schemaVersion: 1,
    taxes: "0.00",
    transactionNotes: "New policy",
    transactionType: "New",
  };
}

function draft(): DraftResponse {
  const timestamp = "2026-07-11T12:00:00.000Z";
  return {
    accountAssignment: "book",
    agencyCommissionAmount: "125.00",
    amountPaid: "250.00",
    basePremium: "1000.00",
    brokerFee: "20.00",
    carrierId: uuid(11),
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: "Flagged Company",
    createdAt: timestamp,
    depositOption: "250.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "780.00",
    financeContact: {
      address: "100 Main Street",
      email: "finance@example.test",
      mobile: "555-0100",
    },
    financeMeta: null,
    financeReference: "FIN-1",
    flagReason: "Need admin help with financing",
    history: [],
    id: DRAFT_ID,
    insuredName: "Flagged Insured",
    invoiceNumber: null,
    ipfsFinanced: "yes",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: "new",
    lastEditedAt: timestamp,
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaFee: "10.00",
    mgaId: uuid(12),
    netDue: "105.00",
    notes: "Private flagged notes",
    officeLocationId: uuid(13),
    ownerUserId: PRODUCER_ID,
    paymentMode: "deposit",
    policyNumber: "WCIB-701",
    policyTypeId: uuid(14),
    producerUserId: PRODUCER_ID,
    proposalTotal: "1030.00",
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "flagged",
    submittedAt: null,
    taxes: "0.00",
    transactionNotes: "Needs review",
    transactionType: "New",
  };
}

function producer(): CurrentUser {
  return {
    allowedNavigation: ["turn_in", "my_items", "my_commissions"],
    capabilities: [],
    displayName: "Kaylee",
    email: "kaylee@example.test",
    id: PRODUCER_ID,
    role: "producer",
  };
}

function admin(): CurrentUser {
  return {
    ...producer(),
    allowedNavigation: ["approvals", "help_requests"],
    capabilities: ["admin"],
    displayName: "Sophia",
    email: "sophia@example.test",
    id: ADMIN_ID,
    role: "admin",
  };
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
