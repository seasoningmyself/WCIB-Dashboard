import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import {
  PRODUCER_COMMISSION_RESPONSE_FIELDS,
  projectProducerCommissionItem,
  projectProducerCommissionSummary,
  type ProducerCommissionItemSource,
} from "./projection.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_PRODUCER_ID = "00000000-0000-4000-8000-000000000002";

const PROHIBITED_FIELDS = [
  "policyNumber",
  "effectiveDate",
  "expirationDate",
  "carrierId",
  "carrierName",
  "mgaId",
  "mgaName",
  "contact",
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
  "ipfsManual",
  "ipfsReturning",
  "ipfsPushed",
  "ipfsPushedAt",
  "agencyRevenue",
  "agencyTotal",
  "agencyTotals",
  "sophiaShare",
  "sophiaTakeHome",
  "rate",
  "rateHistory",
  "rateSnapshot",
  "frozenRateSnapshot",
  "producerUserId",
  "producerDisplayName",
] as const;

test("producer commission projector returns the exact minimal own-item allowlist", () => {
  const source = {
    ...commissionSource(),
    amountPaid: "999.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: "00000000-0000-4000-8000-000000000010",
    carrierName: "Private Carrier",
    commissionAmount: "125.00",
    commissionMode: "pct",
    commissionRate: "12.5000",
    contact: { email: "private@example.test" },
    contacts: [{ phone: "555-0100" }],
    depositOption: "250.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "750.00",
    financeContact: { email: "finance@example.test" },
    financeMeta: { billingType: "invoice" },
    financeReference: "PRIVATE-REF",
    frozenRateSnapshot: { newCommissionRate: "25.00" },
    ipfsFinanced: "yes",
    ipfsManual: true,
    ipfsPushed: true,
    ipfsPushedAt: new Date(),
    ipfsReturning: "returning",
    mgaFee: "25.00",
    mgaId: "00000000-0000-4000-8000-000000000011",
    mgaName: "Private MGA",
    netDue: "824.00",
    paymentMode: "deposit",
    policyNumber: "PRIVATE-POLICY",
    producerDisplayName: "Another Producer",
    producerUserId: OTHER_PRODUCER_ID,
    proposalTotal: "1075.00",
    rate: "25.00",
    rateHistory: [{ rate: "30.00" }],
    rateSnapshot: { renewalCommissionRate: "20.00" },
    sophiaShare: "131.25",
    sophiaTakeHome: "131.25",
    taxes: "25.00",
  };

  const projected = projectProducerCommissionItem(
    source,
    context(OWNER_ID, "producer"),
  );
  assert.ok(projected);
  assert.deepEqual(Object.keys(projected), [...PRODUCER_COMMISSION_RESPONSE_FIELDS]);
  assert.deepEqual(projected, {
    estimate: false,
    id: "00000000-0000-4000-8000-000000000100",
    insuredName: "Allowed Insured",
    payout: "37.50",
    policyType: "General Liability",
    receivedAt: null,
    section: "owed",
    status: "awaiting_payment",
    transactionType: "New",
  });
  const serialized = JSON.stringify(projected);
  for (const field of PROHIBITED_FIELDS) {
    assert.equal(
      serialized.includes(`\"${field}\"`),
      false,
      `${field} must be absent`,
    );
  }
});

test("producer commission projector denies every non-owner context", () => {
  const source = commissionSource();
  assert.equal(
    projectProducerCommissionItem(
      source,
      context(OTHER_PRODUCER_ID, "producer"),
    ),
    null,
  );
  assert.equal(
    projectProducerCommissionItem(source, context(OWNER_ID, "employee")),
    null,
  );
  assert.equal(
    projectProducerCommissionItem(source, context(OWNER_ID, null, ["admin"])),
    null,
  );
  assert.equal(
    projectProducerCommissionItem(
      source,
      context(OWNER_ID, "producer", [], false),
    ),
    null,
  );
});

test("producer commission summary is independently owner-projected", () => {
  const source = {
    inReviewCount: 2,
    owedAmount: "50.00",
    owedCount: 1,
    ownerUserId: OWNER_ID,
    paidLast30DaysAmount: "25.00",
    paidLast30DaysCount: 1,
  };
  assert.deepEqual(
    projectProducerCommissionSummary(source, context(OWNER_ID, "producer")),
    {
      inReviewCount: 2,
      owedAmount: "50.00",
      owedCount: 1,
      paidLast30DaysAmount: "25.00",
      paidLast30DaysCount: 1,
    },
  );
  assert.equal(
    projectProducerCommissionSummary(
      source,
      context(OTHER_PRODUCER_ID, "producer"),
    ),
    null,
  );
});

function commissionSource(): ProducerCommissionItemSource {
  return {
    accountGroup: "book",
    estimate: false,
    id: "00000000-0000-4000-8000-000000000100",
    insuredName: "Allowed Insured",
    ownerUserId: OWNER_ID,
    payout: "37.50",
    policyType: "General Liability",
    receivedAt: null,
    section: "owed",
    status: "awaiting_payment",
    transactionType: "New",
  };
}

function context(
  userId: string,
  staffRole: "employee" | "producer" | null,
  capabilities: readonly "admin"[] = [],
  userActive = true,
): AuthorizedRequestContext {
  return {
    principal: { capabilities: [...capabilities], staffRole, userActive, userId },
  };
}
