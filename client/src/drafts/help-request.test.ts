import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftResponse } from "../../../shared/drafts.js";
import { canRequestDraftHelp, parseHelpReason } from "./help-request.js";

const USER_ID = "00000000-0000-4000-8000-000000000401";
const OTHER_ID = "00000000-0000-4000-8000-000000000402";

test("help reasons are required, trimmed, and bounded to the C5 contract", () => {
  assert.deepEqual(parseHelpReason("   "), {
    error: "Explain what you need help with.",
    success: false,
  });
  assert.deepEqual(parseHelpReason("  Need MGA guidance  "), {
    reason: "Need MGA guidance",
    success: true,
  });
  assert.deepEqual(parseHelpReason("x".repeat(500)), {
    reason: "x".repeat(500),
    success: true,
  });
  assert.deepEqual(parseHelpReason("x".repeat(501)), {
    error: "Keep the help reason to 500 characters or fewer.",
    success: false,
  });
});

test("help access is exact to employee or producer ownership and draft status", () => {
  const active = draft();
  assert.equal(canRequestDraftHelp(user("employee"), active), true);
  assert.equal(canRequestDraftHelp(user("producer"), active), true);
  assert.equal(canRequestDraftHelp(user("admin"), active), false);
  assert.equal(
    canRequestDraftHelp(user("producer"), { ...active, ownerUserId: OTHER_ID }),
    false,
  );
  assert.equal(
    canRequestDraftHelp(user("producer"), { ...active, status: "flagged" }),
    false,
  );
  assert.equal(canRequestDraftHelp(user("producer"), null), false);
});

function user(role: CurrentUser["role"]): CurrentUser {
  return {
    allowedNavigation: ["turn_in", "my_items"],
    capabilities: role === "admin" ? ["admin"] : [],
    displayName: "QA User",
    email: "qa@example.test",
    id: USER_ID,
    passwordChangeRequired: false,
    role,
  };
}

function draft(): DraftResponse {
  return {
    accountAssignment: "book",
    carrierId: null,
    companyName: null,
    createdAt: "2026-07-10T12:00:00.000Z",
    effectiveDate: null,
    expirationDate: null,
    flagReason: null,
    history: [],
    id: "00000000-0000-4000-8000-000000000403",
    insuredName: "Acme LLC",
    invoiceNumber: null,
    lastEditedAt: "2026-07-10T12:00:00.000Z",
    linkedPolicyId: null,
    linkedQueueEntryId: null,
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
    status: "draft",
    submittedAt: null,
    transactionNotes: null,
    transactionType: null,
  };
}
