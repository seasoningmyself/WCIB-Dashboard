import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import {
  buildTrustedPolicyInsert,
  PolicyLifecycleAccessError,
  requireLifecycleAdmin,
  requireLifecycleStaff,
  type PolicyLifecycleInput,
} from "./lifecycle.js";

function context(
  input: Partial<AuthorizedRequestContext["principal"]> = {},
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole: null,
      userActive: true,
      userId: randomUUID(),
      ...input,
    },
  };
}

function policyInput(): PolicyLifecycleInput {
  return {
    accountAssignment: "none",
    amountPaid: "0.00",
    basePremium: "0.00",
    brokerFee: "0.00",
    carrierId: randomUUID(),
    commissionAmount: "0.00",
    commissionConfirmed: false,
    commissionMode: "na",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "0.00",
    insuredName: "Lifecycle Insured",
    kayleeSplit: "none",
    mgaId: randomUUID(),
    netDue: "0.00",
    officeLocationId: randomUUID(),
    paymentMode: "full",
    policyNumber: "LIFECYCLE-1",
    policyTypeId: randomUUID(),
    proposalTotal: "0.00",
    transactionType: "New",
  };
}

test("lifecycle access derives staff and admin decisions from trusted context", () => {
  const employee = context({ staffRole: "employee" });
  const admin = context({ capabilities: ["admin"] });

  assert.equal(requireLifecycleStaff(employee), employee.principal.userId);
  assert.equal(requireLifecycleAdmin(admin), admin.principal.userId);
  assert.throws(
    () => requireLifecycleAdmin(employee),
    PolicyLifecycleAccessError,
  );
  assert.throws(
    () => requireLifecycleStaff(admin),
    PolicyLifecycleAccessError,
  );
  assert.throws(
    () =>
      requireLifecycleAdmin(
        context({ capabilities: ["admin"], userActive: false }),
      ),
    PolicyLifecycleAccessError,
  );
});

test("trusted policy inserts discard forged identity and inert payment state", () => {
  const approvedAt = new Date("2026-07-10T12:00:00.000Z");
  const submittedAt = new Date("2026-07-10T11:00:00.000Z");
  const sourceDraftId = randomUUID();
  const submittedByUserId = randomUUID();
  const forged = {
    ...policyInput(),
    approvedAt: new Date("2000-01-01T00:00:00.000Z"),
    carrierFee: "999.00",
    collectedToDate: "999.00",
    id: randomUUID(),
    ipfsPushed: true,
    mgaPaid: true,
    mgaPayReference: "forged",
    premiumTotal: "999.00",
    sourceDraftId: randomUUID(),
    submittedByUserId: randomUUID(),
  } as unknown as PolicyLifecycleInput;

  const values = buildTrustedPolicyInsert(forged, {
    approvedAt,
    sourceDraftId,
    submittedAt,
    submittedByUserId,
  });

  assert.equal(values.sourceDraftId, sourceDraftId);
  assert.equal(values.submittedByUserId, submittedByUserId);
  assert.equal(values.approvedAt, approvedAt);
  assert.equal(values.submittedAt, submittedAt);
  assert.equal(values.mgaPaid, false);
  assert.equal(values.mgaPayReference, null);
  assert.equal(values.ipfsPushed, false);
  assert.equal(values.premiumTotal, "0.00");
  assert.equal(values.collectedToDate, "0.00");
  assert.equal(Object.hasOwn(values, "id"), false);
  assert.equal(Object.hasOwn(values, "carrierFee"), false);
});
