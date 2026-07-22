import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { buildPaySheetPolicySnapshot } from "../pay-sheets/snapshots.js";
import type { ClosedKpiFact } from "./closed-facts.js";
import {
  buildKpiActualResponse,
  KpiActualConsistencyError,
  projectAdminKpiActualSource,
} from "./actuals.js";

const ADMIN_ID = uuid(1);
const PRODUCER_A = uuid(2);
const PRODUCER_B = uuid(3);
const OFFICE_A = uuid(4);
const OFFICE_B = uuid(5);

test("company actuals separate Sophia agency facts from producer payout facts", () => {
  const agencyFacts = [
    fact({
      agencyRevenue: "100.00",
      month: 1,
      officeLocationId: OFFICE_A,
      ownerType: "sophia",
      ownerUserId: ADMIN_ID,
      producerUserId: PRODUCER_A,
      payout: "25.00",
      split: "house",
      transactionType: "New",
    }),
    fact({
      agencyRevenue: "50.00",
      month: 2,
      officeLocationId: OFFICE_B,
      ownerType: "sophia",
      ownerUserId: ADMIN_ID,
      producerUserId: PRODUCER_B,
      payout: "10.00",
      split: "book",
      transactionType: "Won Back",
    }),
  ];
  const payoutFacts = [
    { ...agencyFacts[0]!, ownerType: "producer" as const, ownerUserId: PRODUCER_A },
    { ...agencyFacts[1]!, ownerType: "producer" as const, ownerUserId: PRODUCER_B },
  ];
  const actuals = buildKpiActualResponse(
    { period: "Q1", scopeType: "company", year: 2026 },
    agencyFacts,
    payoutFacts,
    labels(null),
  );

  assert.deepEqual(actuals.totals, {
    agencyRevenue: "150.00",
    existingPolicyCount: 1,
    newPolicyCount: 1,
    newRevenue: "100.00",
    policyCount: 2,
    producerBookPayout: "10.00",
    producerFirstYearHousePayout: "25.00",
    producerPayout: "35.00",
    retentionRate: "50.00",
    wonBackCount: 1,
    wonBackRevenue: "50.00",
  });
  assert.deepEqual(actuals.monthly, [
    {
      agencyRevenue: "100.00",
      month: 1,
      newPolicyCount: 1,
      policyCount: 1,
      producerPayout: "25.00",
    },
    {
      agencyRevenue: "50.00",
      month: 2,
      newPolicyCount: 0,
      policyCount: 1,
      producerPayout: "10.00",
    },
    {
      agencyRevenue: "0.00",
      month: 3,
      newPolicyCount: 0,
      policyCount: 0,
      producerPayout: "0.00",
    },
  ]);
  assert.equal(actuals.producerPayouts.length, 2);
  assert.equal(actuals.transactionTypes.length, 2);
  assert.equal(actuals.offices.length, 2);
});

test("producer actuals include only the selected UUID and empty periods stay explicit", () => {
  const ownFact = fact({
    agencyRevenue: "99.99",
    month: 7,
    officeLocationId: OFFICE_A,
    ownerType: "producer",
    ownerUserId: PRODUCER_A,
    producerUserId: PRODUCER_A,
    payout: "33.33",
    split: "book",
    transactionType: "New",
  });
  const actuals = buildKpiActualResponse(
    {
      period: "Q3",
      producerUserId: PRODUCER_A,
      scopeType: "producer",
      year: 2026,
    },
    [ownFact],
    [ownFact],
    labels("Producer A"),
  );
  assert.equal(actuals.scope.producerUserId, PRODUCER_A);
  assert.equal(actuals.scope.displayName, "Producer A");
  assert.equal(actuals.totals.agencyRevenue, "99.99");
  assert.equal(actuals.totals.producerPayout, "33.33");
  assert.deepEqual(actuals.producerPayouts.map(({ producerUserId }) => producerUserId), [
    PRODUCER_A,
  ]);

  const empty = buildKpiActualResponse(
    { period: "Q4", scopeType: "company", year: 2026 },
    [],
    [],
    labels(null),
  );
  assert.equal(empty.empty, true);
  assert.equal(empty.totals.retentionRate, null);
  assert.deepEqual(empty.monthly.map(({ month }) => month), [10, 11, 12]);
});

test("payout facts reject mismatched producer ownership and projection defaults closed", () => {
  const mismatched = fact({
    agencyRevenue: "10.00",
    month: 1,
    officeLocationId: OFFICE_A,
    ownerType: "producer",
    ownerUserId: PRODUCER_A,
    producerUserId: PRODUCER_B,
    payout: "2.50",
    split: "book",
    transactionType: "New",
  });
  assert.throws(
    () => buildKpiActualResponse(
      { period: "Q1", scopeType: "company", year: 2026 },
      [],
      [mismatched],
      labels(null),
    ),
    KpiActualConsistencyError,
  );

  const empty = buildKpiActualResponse(
    { period: "Q1", scopeType: "company", year: 2026 },
    [],
    [],
    labels(null),
  );
  const source = { actuals: empty, agencyFactCount: 99, payoutFactCount: 99 };
  assert.deepEqual(projectAdminKpiActualSource(source, adminContext()), empty);
  assert.equal(projectAdminKpiActualSource(source, employeeContext()), null);
  assert.equal(JSON.stringify(empty).includes("FactCount"), false);
});

function fact(input: {
  agencyRevenue: string;
  month: number;
  officeLocationId: string;
  ownerType: "producer" | "sophia";
  ownerUserId: string;
  payout: string;
  producerUserId: string;
  split: "book" | "house";
  transactionType: string;
}): ClosedKpiFact {
  const snapshot = buildPaySheetPolicySnapshot({
    approvedAt: "2026-01-01T12:00:00.000Z",
    brokerFee: "0.00",
    commissionAmount: input.agencyRevenue,
    effectiveDate: "2026-01-01",
    insuredName: `KPI ${input.ownerUserId}`,
    kayleeSplit: input.split,
    officeLocationId: input.officeLocationId,
    policyId: uuid(100 + input.month),
    policyNumber: `KPI-${input.month}`,
    policyTypeClass: "Commercial",
    policyTypeName: "General Liability",
    producerPayout: input.payout,
    producerUserId: input.producerUserId,
    sophiaShare: "0.00",
    transactionType: input.transactionType,
  });
  return {
    addedAt: new Date("2026-01-31T12:00:00.000Z"),
    closedAt: new Date("2026-01-31T13:00:00.000Z"),
    ownerType: input.ownerType,
    ownerUserId: input.ownerUserId,
    paySheetId: uuid(200 + input.month),
    paySheetPolicyId: uuid(300 + input.month),
    periodMonth: input.month,
    periodYear: 2026,
    snapshot,
  };
}

function labels(scopeDisplayName: string | null) {
  return {
    offices: new Map([
      [OFFICE_A, "San Francisco"],
      [OFFICE_B, "Oakland"],
    ]),
    producers: new Map([
      [PRODUCER_A, "Producer A"],
      [PRODUCER_B, "Producer B"],
    ]),
    scopeDisplayName,
  };
}

function adminContext(): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId: ADMIN_ID,
    },
  };
}

function employeeContext(): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole: "employee",
      userActive: true,
      userId: PRODUCER_B,
    },
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
