import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  formatPayableCommissionRate,
  formatPayableDate,
  isMgaPayablesAdmin,
  oldestOutstandingDays,
  outstandingShare,
  payableAccountLabel,
  payableAging,
  payableGroupAction,
} from "./view-state.js";
import { payableItemFixture, payablesFixture, uuid } from "./test-fixture.js";

test("MGA payable account labels preserve the approved assignment display", () => {
  assert.equal(payableAccountLabel(payableItemFixture()), "Kaylee's book");
  assert.equal(
    payableAccountLabel(payableItemFixture({ kayleeSplit: "house" })),
    "1st-yr house - Kaylee",
  );
  assert.equal(
    payableAccountLabel(
      payableItemFixture({
        accountAssignment: "none",
        kayleeSplit: "none",
        producerDisplayName: null,
        producerUserId: null,
      }),
    ),
    "Sophia's account",
  );
});

test("MGA payable aging matches v15 30 and 60 day boundaries", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  assert.equal(
    payableAging(
      payableItemFixture({ approvedAt: "2026-06-12T12:00:00.000Z" }),
      now,
    ),
    null,
  );
  assert.deepEqual(
    payableAging(
      payableItemFixture({ approvedAt: "2026-06-11T12:00:00.000Z" }),
      now,
    ),
    { label: "30d outstanding", tone: "warning" },
  );
  assert.deepEqual(
    payableAging(
      payableItemFixture({ approvedAt: "2026-05-12T12:00:00.000Z" }),
      now,
    ),
    { label: "60d outstanding", tone: "danger" },
  );
  assert.equal(
    payableAging(payableItemFixture({ status: "paid" }), now),
    null,
  );
});

test("MGA group context reports exact share and oldest unpaid age", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const group = payablesFixture().groups[0]!;
  group.items = [
    payableItemFixture({ approvedAt: "2026-05-01T12:00:00.000Z" }),
    payableItemFixture({
      approvedAt: "2026-04-01T12:00:00.000Z",
      policyId: uuid(70),
      status: "paid",
    }),
  ];

  assert.equal(oldestOutstandingDays(group, now), 71);
  assert.equal(outstandingShare("1075.01", "2150.02"), "50%");
  assert.equal(outstandingShare("1.00", "3.00"), "33.3%");
  assert.equal(outstandingShare("0.00", "0.00"), "0%");
});

test("MGA group action targets only the state that differs", () => {
  const group = payablesFixture().groups[0]!;
  assert.deepEqual(payableGroupAction(group), {
    count: 1,
    label: "Mark all paid",
    status: "paid",
  });
  group.totals = {
    outstandingAmount: "0.00",
    paidAmount: "850.00",
    paidCount: 1,
    totalCount: 1,
    unpaidCount: 0,
  };
  assert.deepEqual(payableGroupAction(group), {
    count: 1,
    label: "Unmark all",
    status: "unpaid",
  });
});

test("MGA payable role and date formatting fail closed", () => {
  const admin: CurrentUser = {
    allowedNavigation: ["mga_payables"],
    capabilities: ["admin"],
    displayName: "Sophia",
    email: "admin@example.test",
    id: uuid(90),
    passwordChangeRequired: false,
    role: "admin",
  };
  assert.equal(isMgaPayablesAdmin(admin), true);
  assert.equal(
    isMgaPayablesAdmin({ ...admin, capabilities: [], role: "admin" }),
    false,
  );
  assert.equal(
    isMgaPayablesAdmin({ ...admin, role: "employee" }),
    false,
  );
  assert.equal(formatPayableDate("2026-07-11T12:00:00.000Z"), "Jul 11, 2026");
  assert.equal(formatPayableCommissionRate("12.5000"), "12.5%");
  assert.equal(formatPayableCommissionRate("0.0000"), null);
  assert.equal(formatPayableCommissionRate(null), null);
});
