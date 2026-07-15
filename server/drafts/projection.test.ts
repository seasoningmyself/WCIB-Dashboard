import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessPrincipal } from "../auth/access.js";
import type { DraftRecord } from "../db/schema.js";
import {
  canAccessDraft,
  DRAFT_FINANCIAL_FIELDS,
  OWN_ACTIVE_STAFF_DRAFT_FINANCIAL_VISIBILITY,
  projectDraftForAuthorizedContext,
  type DraftFullProjection,
  type DraftProjection,
} from "./projection.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";

function principal(
  input: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: "employee",
    userActive: true,
    userId: OWNER_ID,
    ...input,
  };
}

function draft(input: Partial<DraftRecord> = {}): DraftRecord {
  return {
    accountAssignment: "book",
    amountPaid: "300.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: null,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: "Company",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    deleteReason: null,
    deletedAt: null,
    deletedByUserId: null,
    depositOption: "300.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "780.00",
    financeContact: { email: "private@example.test" },
    financeMeta: { billingType: "invoice" },
    financeReference: "PRIVATE-REFERENCE",
    flagReason: null,
    history: [],
    id: "00000000-0000-4000-8000-000000000010",
    insuredName: "Insured",
    invoiceNumber: "INV-1",
    ipfsFinanced: "yes",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: "new",
    lastEditedAt: new Date("2026-07-01T12:00:00.000Z"),
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaFee: "25.00",
    mgaId: null,
    netDue: "125.00",
    notes: "Notes",
    officeLocationId: null,
    ownerUserId: OWNER_ID,
    paymentMode: "deposit",
    policyNumber: "POL-1",
    policyTypeId: null,
    producerUserId: null,
    proposalTotal: "1080.00",
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "draft",
    submittedAt: null,
    taxes: "5.00",
    transactionNotes: "Transaction notes",
    transactionType: "Won Back",
    ...input,
  };
}

function assertFullProjection(
  projected: DraftProjection,
): asserts projected is DraftFullProjection {
  assert.ok(projected && "basePremium" in projected);
}

test("staff financial visibility is isolated to one explicit policy", () => {
  assert.equal(
    OWN_ACTIVE_STAFF_DRAFT_FINANCIAL_VISIBILITY,
    "own_editing_draft_only",
  );

  const projected = projectDraftForAuthorizedContext(draft(), {
    principal: principal(),
  });
  assertFullProjection(projected);
  assert.equal(projected.basePremium, "1000.00");
  assert.equal(projected.agencyCommissionAmount, "125.00");
  assert.deepEqual(projected.financeContact, {
    email: "private@example.test",
  });
});

test("every non-draft staff projection omits every financial field", () => {
  for (const status of [
    "submitted",
    "flagged",
    "sent_back",
    "approved",
  ] as const) {
    const projected = projectDraftForAuthorizedContext(draft({ status }), {
      principal: principal(),
    });
    assert.ok(projected);
    assert.equal(projected.status, status);
    for (const field of DRAFT_FINANCIAL_FIELDS) {
      assert.equal(field in projected, false, `${status} exposed ${field}`);
    }
    assert.equal(
      "agencyCommissionAmount" in projected,
      false,
      `${status} exposed agencyCommissionAmount`,
    );
  }
});

test("draft scope denies another user and every unassigned or inactive identity", () => {
  assert.equal(canAccessDraft(principal(), OWNER_ID), true);
  assert.equal(
    projectDraftForAuthorizedContext(draft({ ownerUserId: OTHER_ID }), {
      principal: principal(),
    }),
    null,
  );
  assert.equal(
    projectDraftForAuthorizedContext(draft(), {
      principal: principal({ staffRole: null }),
    }),
    null,
  );
  assert.equal(
    projectDraftForAuthorizedContext(draft(), {
      principal: principal({ userActive: false }),
    }),
    null,
  );
});

test("producer editing scope stays owner-only while admin uses an explicit full projection", () => {
  const producerProjection = projectDraftForAuthorizedContext(draft(), {
    principal: principal({ staffRole: "producer" }),
  });
  assertFullProjection(producerProjection);
  assert.equal(producerProjection.netDue, "125.00");
  assert.equal(producerProjection.agencyCommissionAmount, "125.00");

  const producerOther = projectDraftForAuthorizedContext(
    draft({ ownerUserId: OTHER_ID }),
    { principal: principal({ staffRole: "producer" }) },
  );
  assert.equal(producerOther, null);

  const adminProjection = projectDraftForAuthorizedContext(
    draft({ ownerUserId: OTHER_ID, status: "approved" }),
    {
      principal: principal({ capabilities: ["admin"], staffRole: null }),
    },
  );
  assertFullProjection(adminProjection);
  assert.equal(adminProjection.commissionRate, "12.5000");
  assert.equal(adminProjection.agencyCommissionAmount, "125.00");
  assert.deepEqual(adminProjection.financeMeta, { billingType: "invoice" });
});

test("draft projection never emits a producer personal rate or payout", () => {
  const source = Object.assign(draft(), {
    applicableProducerRate: "25.0000",
    producerPayout: "31.25",
    producerRate: "25.0000",
    producerRateHistory: [{ rate: "25.0000" }],
  });
  for (const access of [
    principal({ staffRole: "employee" }),
    principal({ staffRole: "producer" }),
    principal({ capabilities: ["admin"], staffRole: null }),
  ]) {
    const projected = projectDraftForAuthorizedContext(source, {
      principal: access,
    });
    assert.ok(projected);
    for (const field of [
      "applicableProducerRate",
      "producerPayout",
      "producerRate",
      "producerRateHistory",
    ]) {
      assert.equal(field in projected, false, field);
    }
  }
});
