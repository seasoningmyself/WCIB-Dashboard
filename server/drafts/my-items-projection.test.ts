import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessPrincipal } from "../auth/access.js";
import type { DraftRecord } from "../db/schema.js";
import {
  MY_ITEM_FIELDS,
  projectMyItemForAuthorizedContext,
} from "./my-items-projection.js";
import { DRAFT_FINANCIAL_FIELDS } from "./projection.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";

test("My Items projection exposes exactly the status-safe allowlist", () => {
  for (const role of ["employee", "producer"] as const) {
    const projected = projectMyItemForAuthorizedContext(draft(), {
      principal: principal({ staffRole: role }),
    });
    assert.ok(projected);
    assert.deepEqual(Object.keys(projected), MY_ITEM_FIELDS);
    assert.equal(projected.title, "Acme Construction");

    for (const field of [
      ...DRAFT_FINANCIAL_FIELDS,
      "agencyCommissionAmount",
      "ownerUserId",
      "policyNumber",
      "producerUserId",
      "linkedPolicyId",
      "linkedQueueEntryId",
      "history",
    ]) {
      assert.equal(field in projected, false, field);
    }
  }
});

test("My Items projection remains zero-financial for an active draft", () => {
  const source = Object.assign(draft(), {
    agencyCommissionAmount: "250.00",
    producerPayout: "62.50",
    producerRate: "25.0000",
  });
  const projected = projectMyItemForAuthorizedContext(source, {
    principal: principal({ staffRole: "producer" }),
  });
  assert.ok(projected);
  for (const field of [
    ...DRAFT_FINANCIAL_FIELDS,
    "agencyCommissionAmount",
    "producerPayout",
    "producerRate",
  ]) {
    assert.equal(field in projected, false, field);
  }
});

test("My Items projection is owner-only and default-deny", () => {
  assert.equal(
    projectMyItemForAuthorizedContext(draft({ ownerUserId: OTHER_ID }), {
      principal: principal(),
    }),
    null,
  );
  for (const access of [
    principal({ staffRole: null }),
    principal({ capabilities: ["admin"], staffRole: null }),
    principal({ userActive: false }),
  ]) {
    assert.equal(
      projectMyItemForAuthorizedContext(draft(), { principal: access }),
      null,
    );
  }
});

test("My Items projection bounds status reasons and removes them elsewhere", () => {
  const flagged = projectMyItemForAuthorizedContext(
    draft({ flagReason: `  ${"x".repeat(600)}  `, status: "flagged" }),
    { principal: principal() },
  );
  assert.ok(flagged);
  assert.equal(flagged.reason?.length, 500);

  const sentBack = projectMyItemForAuthorizedContext(
    draft({ sentBackReason: "  Correct the carrier  ", status: "sent_back" }),
    { principal: principal({ staffRole: "producer" }) },
  );
  assert.equal(sentBack?.reason, "Correct the carrier");

  const approved = projectMyItemForAuthorizedContext(
    draft({ flagReason: "private", status: "approved" }),
    { principal: principal() },
  );
  assert.equal(approved?.reason, null);

  const companyFallback = projectMyItemForAuthorizedContext(
    draft({ companyName: "Company fallback", insuredName: "   " }),
    { principal: principal() },
  );
  assert.equal(companyFallback?.title, "Company fallback");
});

function principal(input: Partial<AccessPrincipal> = {}): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: "employee",
    userActive: true,
    userId: OWNER_ID,
    ...input,
  };
}

function draft(input: Partial<DraftRecord> = {}): DraftRecord {
  const timestamp = new Date("2026-07-11T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "300.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: null,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "25.0000",
    companyName: "Acme LLC",
    createdAt: timestamp,
    depositOption: "300.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "700.00",
    financeContact: { address: "", email: "private@example.test", mobile: "" },
    financeMeta: {
      billingType: "invoice",
      loanType: "commercial",
      minEarnedAmt: null,
      minEarnedPct: null,
    },
    financeReference: "PRIVATE",
    flagReason: null,
    history: [],
    id: "00000000-0000-4000-8000-000000000010",
    insuredName: "Acme Construction",
    invoiceNumber: "INV-1",
    ipfsFinanced: "yes",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: "new",
    lastEditedAt: timestamp,
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaFee: "25.00",
    mgaId: null,
    netDue: "475.00",
    notes: "Private note",
    officeLocationId: null,
    ownerUserId: OWNER_ID,
    paymentMode: "deposit",
    policyNumber: "PRIVATE-POLICY",
    policyTypeId: null,
    producerUserId: OWNER_ID,
    proposalTotal: "1075.00",
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "draft",
    submittedAt: null,
    taxes: "0.00",
    transactionNotes: "Private transaction note",
    transactionType: "New Business",
    ...input,
  };
}
