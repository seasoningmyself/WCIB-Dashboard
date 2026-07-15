import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  formatPayableCommissionRate,
  formatPayableDate,
  isMgaPayablesAdmin,
  payableAccountLabel,
  payableAging,
} from "./view-state.js";
import { payableItemFixture, uuid } from "./test-fixture.js";

test("MGA payable account labels preserve the approved assignment display", () => {
  assert.equal(payableAccountLabel(payableItemFixture()), "Kaylee account");
  assert.equal(
    payableAccountLabel(payableItemFixture({ kayleeSplit: "house" })),
    "Kaylee first year",
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
    "Sophia house",
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
    { label: "30d", tone: "warning" },
  );
  assert.deepEqual(
    payableAging(
      payableItemFixture({ approvedAt: "2026-05-12T12:00:00.000Z" }),
      now,
    ),
    { label: "60d overdue", tone: "danger" },
  );
  assert.equal(
    payableAging(payableItemFixture({ status: "paid" }), now),
    null,
  );
});

test("MGA payable role and date formatting fail closed", () => {
  const admin: CurrentUser = {
    allowedNavigation: ["mga_payables"],
    capabilities: ["admin"],
    displayName: "Sophia",
    email: "admin@example.test",
    id: uuid(90),
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
