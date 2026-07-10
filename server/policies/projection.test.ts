import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessPrincipal } from "../auth/access.js";
import type { PolicyRecord } from "../db/schema.js";
import {
  POLICY_FINANCIAL_FIELDS,
  projectAdminPolicy,
} from "./projection.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function principal(
  input: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: "employee",
    userActive: true,
    userId: USER_ID,
    ...input,
  };
}

function policy(): PolicyRecord {
  const timestamp = new Date("2026-07-01T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "350.00",
    approvedAt: timestamp,
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: "00000000-0000-4000-8000-000000000002",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: "Company",
    createdAt: timestamp,
    depositOption: "350.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "775.00",
    financeContact: { email: "private@example.test" },
    financeMeta: { billingType: "invoice" },
    financeReference: "PRIVATE-REFERENCE",
    id: "00000000-0000-4000-8000-000000000010",
    insuredName: "Private Insured",
    invoiceNumber: null,
    ipfsFinanced: "yes",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: "new",
    kayleeSplit: "book",
    mgaFee: "25.00",
    mgaId: "00000000-0000-4000-8000-000000000003",
    mgaPaid: false,
    mgaPaidAt: null,
    mgaPayReference: null,
    netDue: "175.00",
    notes: "Private notes",
    officeLocationId: "00000000-0000-4000-8000-000000000004",
    paymentMode: "deposit",
    policyNumber: "POL-1",
    policyTypeId: "00000000-0000-4000-8000-000000000005",
    producerUserId: "00000000-0000-4000-8000-000000000006",
    proposalTotal: "1125.00",
    sourceDraftId: null,
    submittedAt: timestamp,
    submittedByUserId: USER_ID,
    taxes: "50.00",
    transactionNotes: "Returned after a coverage gap",
    transactionType: "Won Back",
    updatedAt: timestamp,
  };
}

test("raw policy projection is default-deny for employee and producer roles", () => {
  assert.equal(
    projectAdminPolicy(policy(), { principal: principal() }),
    null,
  );
  assert.equal(
    projectAdminPolicy(policy(), {
      principal: principal({ staffRole: "producer" }),
    }),
    null,
  );
});

test("active admin projection explicitly includes every core financial field", () => {
  const projected = projectAdminPolicy(policy(), {
    principal: principal({ capabilities: ["admin"], staffRole: null }),
  });
  assert.ok(projected);
  for (const field of POLICY_FINANCIAL_FIELDS) {
    assert.equal(field in projected, true, `admin projection omitted ${field}`);
  }
  assert.equal(projected.transactionType, "Won Back");

  assert.equal(
    projectAdminPolicy(policy(), {
      principal: principal({
        capabilities: ["admin"],
        staffRole: null,
        userActive: false,
      }),
    }),
    null,
  );
});
