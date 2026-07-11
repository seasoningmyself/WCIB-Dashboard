import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftResponse } from "../../../shared/drafts.js";
import {
  draftActionLabel,
  draftStatusLabel,
  replaceProjectedDraft,
  resolveDraftSelection,
  sortOwnDrafts,
} from "./my-drafts-state.js";

const DRAFT_ID = "00000000-0000-4000-8000-000000000201";
const OTHER_ID = "00000000-0000-4000-8000-000000000202";

test("My Drafts selection accepts one opaque UUID and rejects ambiguous guesses", () => {
  assert.deepEqual(resolveDraftSelection("/my-drafts"), { status: "list" });
  assert.deepEqual(resolveDraftSelection(`/my-drafts?draft=${DRAFT_ID}`), {
    draftId: DRAFT_ID,
    status: "selected",
  });
  assert.deepEqual(resolveDraftSelection("/my-drafts?draft=not-a-uuid"), {
    status: "invalid",
  });
  assert.deepEqual(
    resolveDraftSelection(`/my-drafts?draft=${DRAFT_ID}&draft=${OTHER_ID}`),
    { status: "invalid" },
  );
});

test("new projections replace rather than merge sensitive draft state", () => {
  const financialDraft = draft({
    agencyCommissionAmount: "100.00",
    basePremium: "1000.00",
    id: DRAFT_ID,
    status: "draft",
  });
  const submitted = draft({
    id: DRAFT_ID,
    lastEditedAt: "2026-07-10T13:00:00.000Z",
    status: "submitted",
    submittedAt: "2026-07-10T13:00:00.000Z",
  });

  const result = replaceProjectedDraft([financialDraft], submitted);

  assert.deepEqual(result, [submitted]);
  assert.equal("basePremium" in result[0]!, false);
  assert.equal("agencyCommissionAmount" in result[0]!, false);
});

test("draft ordering and status actions are deterministic", () => {
  const older = draft({ id: DRAFT_ID });
  const newer = draft({
    id: OTHER_ID,
    lastEditedAt: "2026-07-10T14:00:00.000Z",
    status: "sent_back",
  });

  assert.deepEqual(sortOwnDrafts([older, newer]).map(({ id }) => id), [
    OTHER_ID,
    DRAFT_ID,
  ]);
  assert.equal(draftStatusLabel("flagged"), "Help requested");
  assert.equal(draftActionLabel("draft"), "Edit");
  assert.equal(draftActionLabel("sent_back"), "Review and reopen");
  assert.equal(draftActionLabel("approved"), "View status");
});

function draft(overrides: Partial<DraftResponse> = {}): DraftResponse {
  return {
    accountAssignment: "book",
    carrierId: null,
    companyName: null,
    createdAt: "2026-07-10T12:00:00.000Z",
    effectiveDate: null,
    expirationDate: null,
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
    ownerUserId: "00000000-0000-4000-8000-000000000203",
    policyNumber: "WCIB-100",
    policyTypeId: null,
    producerUserId: "00000000-0000-4000-8000-000000000204",
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
