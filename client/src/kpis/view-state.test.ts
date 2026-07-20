import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  buildKpiTargetInput,
  countTargetUnits,
  decodeKpiScope,
  emptyKpiTargetInput,
  encodeKpiScope,
  findKpiTarget,
  formatKpiMoney,
  isKpiAdmin,
  kpiTargetEditorValues,
  moneyToCents,
  rateToHundredths,
  targetProgress,
  trendBarPercent,
} from "./view-state.js";
import { kpiTargetsFixture, PRODUCER_ID } from "./test-fixture.js";

test("KPI view access requires both admin role and capability", () => {
  assert.equal(isKpiAdmin(user("admin", ["admin"])), true);
  assert.equal(isKpiAdmin(user("admin", [])), false);
  assert.equal(isKpiAdmin(user("producer", ["admin"])), false);
  assert.equal(isKpiAdmin(user("employee", [])), false);
});

test("KPI scope keeps producer identity in UUIDs rather than labels", () => {
  const producer = { producerUserId: PRODUCER_ID, scopeType: "producer" } as const;
  assert.equal(encodeKpiScope(producer), `producer:${PRODUCER_ID}`);
  assert.deepEqual(decodeKpiScope(`producer:${PRODUCER_ID}`), producer);
  assert.deepEqual(decodeKpiScope("company"), {
    producerUserId: null,
    scopeType: "company",
  });
  assert.equal(decodeKpiScope("producer:Kaylee Producer"), null);
  assert.equal(decodeKpiScope("company:other"), null);
});

test("KPI target editor normalizes exact values and clear semantics", () => {
  const targets = kpiTargetsFixture();
  const company = { producerUserId: null, scopeType: "company" } as const;
  const target = findKpiTarget(targets, company);
  assert.deepEqual(kpiTargetEditorValues(target), {
    newPolicyCountTarget: "12",
    newRevenueTarget: "125000.00",
    retentionRateTarget: "75.00",
  });
  assert.deepEqual(
    buildKpiTargetInput(
      {
        newPolicyCountTarget: " 15 ",
        newRevenueTarget: "00125000.5",
        retentionRateTarget: "82.5",
      },
      company,
    ),
    {
      input: {
        newPolicyCountTarget: 15,
        newRevenueTarget: "125000.50",
        producerUserId: null,
        retentionRateTarget: "82.50",
      },
      success: true,
    },
  );
  assert.deepEqual(emptyKpiTargetInput(company), {
    newPolicyCountTarget: null,
    newRevenueTarget: null,
    producerUserId: null,
    retentionRateTarget: null,
  });
  for (const values of [
    { newPolicyCountTarget: "1.5", newRevenueTarget: "1.00", retentionRateTarget: "50.00" },
    { newPolicyCountTarget: "1", newRevenueTarget: "-1", retentionRateTarget: "50.00" },
    { newPolicyCountTarget: "1", newRevenueTarget: "1.00", retentionRateTarget: "100.01" },
  ]) {
    assert.equal(buildKpiTargetInput(values, company).success, false);
  }
});

test("KPI presentation keeps money exact and progress bounded", () => {
  assert.equal(formatKpiMoney("120000.60"), "$120,000.60");
  assert.equal(moneyToCents("120000.60"), 12_000_060n);
  assert.equal(rateToHundredths("82.50"), 8_250n);
  assert.equal(countTargetUnits("12"), 12n);
  assert.equal(countTargetUnits("12.5"), null);
  assert.deepEqual(targetProgress(5n, 12n), {
    label: "42% of goal",
    met: false,
    percent: 41.6,
  });
  assert.deepEqual(targetProgress(12n, 12n), {
    label: "Goal met",
    met: true,
    percent: 100,
  });
  assert.equal(targetProgress(1n, 0n), null);
  assert.equal(trendBarPercent("33000.20", ["42000.10", "33000.20"]), 78);
  assert.equal(trendBarPercent("0.00", ["0.00"]), 3);
});

function user(
  role: CurrentUser["role"],
  capabilities: CurrentUser["capabilities"],
): CurrentUser {
  return {
    allowedNavigation: [],
    capabilities,
    displayName: "Test User",
    email: "test@example.test",
    id: "00000000-0000-4000-8000-000000000001",
    passwordChangeRequired: false,
    role,
  };
}
