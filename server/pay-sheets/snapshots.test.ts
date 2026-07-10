import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAY_SHEET_POLICY_SNAPSHOT_FIELDS,
  PAY_SHEET_RATE_SNAPSHOT_FIELDS,
} from "../../shared/pay-sheet-snapshots.js";
import {
  buildPaySheetPolicySnapshot,
  buildPaySheetRateSnapshot,
} from "./snapshots.js";

const policySource = {
  approvedAt: new Date("2026-07-01T12:00:00.000Z"),
  brokerFee: "50.00",
  carrierFee: "999.00",
  commissionAmount: "100.00",
  effectiveDate: "2026-07-01",
  insuredName: "Snapshot Insured",
  kayleeSplit: "book",
  officeLocationId: "00000000-0000-4000-8000-000000000004",
  passwordHash: "must-not-copy",
  policyId: "00000000-0000-4000-8000-000000000001",
  policyNumber: "POL-SNAPSHOT",
  policyTypeClass: "Commercial",
  policyTypeName: "General Liability",
  producerPayout: "37.50",
  producerUserId: "00000000-0000-4000-8000-000000000002",
  rewriteSubtype: "must-not-copy",
  sophiaShare: "112.50",
  transactionType: "Won Back",
};

test("policy snapshots project every KPI field without legacy financial data", () => {
  const snapshot = buildPaySheetPolicySnapshot(policySource);

  assert.deepEqual(Object.keys(snapshot), [...PAY_SHEET_POLICY_SNAPSHOT_FIELDS]);
  assert.equal(snapshot.transactionType, "Won Back");
  assert.equal(snapshot.agencyRevenue, "150.00");
  assert.equal(snapshot.approvedAt, "2026-07-01T12:00:00.000Z");
  assert.equal("carrierFee" in snapshot, false);
  assert.equal("rewriteSubtype" in snapshot, false);
  assert.equal("passwordHash" in snapshot, false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("policy snapshots support unassigned producer UUIDs", () => {
  const snapshot = buildPaySheetPolicySnapshot({
    ...policySource,
    kayleeSplit: "none",
    producerUserId: null,
  });

  assert.equal(snapshot.producerUserId, null);
});

test("rate snapshots copy the effective four-rate contract only", () => {
  const snapshot = buildPaySheetRateSnapshot({
    effectiveDate: "2026-06-01",
    id: "must-not-copy",
    newBrokerRate: "12.50",
    newCommissionRate: "25.00",
    producerUserId: "must-not-copy",
    renewalBrokerRate: "10.00",
    renewalCommissionRate: "20.00",
  });

  assert.deepEqual(Object.keys(snapshot), [...PAY_SHEET_RATE_SNAPSHOT_FIELDS]);
  assert.equal("id" in snapshot, false);
  assert.equal("producerUserId" in snapshot, false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("snapshot builders fail closed with key-only validation errors", () => {
  for (const [field, value] of [
    ["policyId", "not-a-uuid"],
    ["policyTypeClass", "Unknown"],
    ["effectiveDate", "2026-02-30"],
    ["commissionAmount", "100"],
    ["approvedAt", "not-a-timestamp"],
  ] as const) {
    assert.throws(
      () => buildPaySheetPolicySnapshot({ ...policySource, [field]: value }),
      new RegExp(field),
    );
  }
  assert.throws(
    () => buildPaySheetPolicySnapshot({ ...policySource, sophiaShare: undefined }),
    /sophiaShare/,
  );
  assert.throws(
    () =>
      buildPaySheetRateSnapshot({
        effectiveDate: "2026-06-01",
        newBrokerRate: "12.50",
        newCommissionRate: "100.01",
        renewalBrokerRate: "10.00",
        renewalCommissionRate: "20.00",
      }),
    /newCommissionRate/,
  );
});
