import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftResponse } from "../../../shared/drafts.js";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
import { VocabularyProvider } from "../vocabulary/context.js";
import { CheckTurnInFormView } from "./CheckTurnInForm.js";
import {
  buildAssignmentChoices,
  createEmptyTurnInState,
  type TurnInFormState,
} from "./turn-in-state.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

test("Check Turn-In renders every active v15 input and exact producer assignment labels", () => {
  const user = producer();
  const form: TurnInFormState = {
    ...createEmptyTurnInState(),
    accountAssignment: "book",
    commissionMode: "pct",
    ipfsFinanced: "yes",
    ipfsReturning: "new",
    paymentMode: "deposit",
    producerUserId: USER_ID,
    transactionType: "Endorsement",
  };
  const markup = renderView({ form, user });

  for (const label of [
    "Assignment",
    "Office location",
    "Insured name",
    "Company name",
    "Policy type",
    "Transaction type",
    "Effective date",
    "Expiration date",
    "Invoice number",
    "Transaction notes",
    "Insurance company",
    "MGA",
    "Policy number",
    "Base premium",
    "Taxes",
    "MGA fee",
    "Broker fee",
    "Proposal total",
    "Calculated total",
    "Amount collected",
    "Net due to MGA",
    "Agency commission",
    "Carrier commission rate",
    "Agency commission total",
    "Payment mode",
    "Deposit option",
    "Finance balance",
    "Finance reference",
    "IPFS financing",
    "Handle IPFS manually",
    "IPFS insured",
    "Insured mobile",
    "Insured email",
    "Insured mailing address",
    "General notes",
  ]) {
    assert.match(markup, new RegExp(escapeRegExp(label)), label);
  }
  for (const assignment of ["First-year", "House account", "Kaylee account"]) {
    assert.match(markup, new RegExp(`>${escapeRegExp(assignment)}<`));
  }
  assert.match(markup, /Submit for approval/);
  assert.doesNotMatch(markup, /producer payout/i);
  assert.doesNotMatch(markup, /producer personal/i);
  assert.doesNotMatch(markup, /personal split/i);
  assert.doesNotMatch(markup, /producer rate/i);
  assert.doesNotMatch(markup, /localStorage/);
  assert.doesNotMatch(markup, /ownerUserId|linkedPolicyId|status selector/);
});

test("submitted staff turn-ins immediately render no financial or IPFS controls", () => {
  const markup = renderView({
    draft: submittedDraft(),
    form: createEmptyTurnInState(),
    user: producer(),
  });

  assert.match(markup, /Turn-in submitted/);
  assert.match(markup, /approval queue/);
  for (const forbidden of [
    "Base premium",
    "Broker fee",
    "Agency commission total",
    "Amount collected",
    "IPFS financing",
    "Finance balance",
  ]) {
    assert.doesNotMatch(markup, new RegExp(escapeRegExp(forbidden)), forbidden);
  }
});

test("validation state is accessible and admin submission targets the ledger", () => {
  const markup = renderView({
    errors: { insuredName: "Enter the insured name." },
    form: createEmptyTurnInState(),
    user: { ...producer(), capabilities: ["admin"], role: "admin" },
  });

  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /aria-describedby="turn-in-insuredName-error"/);
  assert.match(markup, /Submit to ledger/);
});

test("pending writes disable the complete form and duplicate action buttons", () => {
  const markup = renderView({
    form: createEmptyTurnInState(),
    saveState: "saving",
    user: producer(),
  });
  assert.match(markup, /<fieldset[^>]*class="turn-in-controls"[^>]*disabled=""/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*type="submit"/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*type="button"/);
});

function renderView({
  draft = null,
  errors = {},
  form,
  saveState = "idle",
  user,
}: {
  draft?: DraftResponse | null;
  errors?: Readonly<Record<string, string>>;
  form: TurnInFormState;
  saveState?: "dirty" | "error" | "idle" | "saved" | "saving";
  user: CurrentUser;
}): string {
  const choices = buildAssignmentChoices(user, []);
  return renderToStaticMarkup(
    <ApiClientProvider
      boundary={createSessionBoundary(() => {})}
      client={{ async request() { return Response.json({}); } }}
    >
      <VocabularyProvider>
        <CheckTurnInFormView
          assignmentChoices={choices}
          assignmentState="ready"
          draft={draft}
          errors={errors}
          form={form}
          onAssignmentChange={() => {}}
          onFieldChange={() => {}}
          onRetryAssignments={() => {}}
          onSave={() => {}}
          onSubmit={() => {}}
          saveState={saveState}
          user={user}
        />
      </VocabularyProvider>
    </ApiClientProvider>,
  );
}

function producer(): CurrentUser {
  return {
    allowedNavigation: ["turn_in", "my_items", "my_commissions"],
    capabilities: [],
    displayName: "Kaylee",
    email: "kaylee@example.test",
    id: USER_ID,
    role: "producer",
  };
}

function submittedDraft(): DraftResponse {
  return {
    accountAssignment: "book",
    carrierId: null,
    companyName: null,
    createdAt: "2026-07-10T12:00:00.000Z",
    effectiveDate: null,
    expirationDate: null,
    flagReason: null,
    history: [],
    id: "00000000-0000-4000-8000-000000000002",
    insuredName: "Acme LLC",
    invoiceNumber: null,
    lastEditedAt: "2026-07-10T12:00:00.000Z",
    linkedPolicyId: null,
    linkedQueueEntryId: "00000000-0000-4000-8000-000000000003",
    mgaId: null,
    notes: null,
    officeLocationId: null,
    ownerUserId: USER_ID,
    policyNumber: null,
    policyTypeId: null,
    producerUserId: USER_ID,
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "submitted",
    submittedAt: "2026-07-10T12:05:00.000Z",
    transactionNotes: null,
    transactionType: "New",
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
