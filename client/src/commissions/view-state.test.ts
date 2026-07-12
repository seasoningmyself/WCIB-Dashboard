import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import { commissionItem, commissionsResponse, uuid } from "./test-fixture.js";
import {
  formatCommissionMoney,
  formatReceiptDate,
  groupMyCommissionItems,
  isMyCommissionsProducer,
} from "./view-state.js";

test("producer commission access requires both producer role and server navigation", () => {
  const producer: CurrentUser = {
    allowedNavigation: ["turn_in", "my_items", "my_commissions"],
    capabilities: [],
    displayName: "Kaylee",
    email: "kaylee@example.test",
    id: uuid(2),
    role: "producer",
  };
  assert.equal(isMyCommissionsProducer(producer), true);
  assert.equal(
    isMyCommissionsProducer({ ...producer, allowedNavigation: ["my_items"] }),
    false,
  );
  assert.equal(
    isMyCommissionsProducer({ ...producer, capabilities: ["admin"], role: "admin" }),
    false,
  );
});

test("commission view helpers preserve server section order and safe unavailable values", () => {
  const data = commissionsResponse();
  data.items = [
    commissionItem({ id: uuid(1), section: "owed" }),
    commissionItem({ id: uuid(2), section: "in_review", status: "pending_approval" }),
    commissionItem({ id: uuid(3), receivedAt: "2026-07-11T12:00:00.000Z", section: "paid", status: "received" }),
    commissionItem({ id: uuid(4), section: "owed" }),
  ];

  const grouped = groupMyCommissionItems(data);
  assert.deepEqual(grouped.owed.map(({ id }) => id), [uuid(1), uuid(4)]);
  assert.deepEqual(grouped.inReview.map(({ id }) => id), [uuid(2)]);
  assert.deepEqual(grouped.paid.map(({ id }) => id), [uuid(3)]);
  assert.equal(formatCommissionMoney("1234567.89"), "$1,234,567.89");
  assert.equal(formatCommissionMoney(null), "Unavailable");
  assert.equal(formatCommissionMoney("not-money"), "Unavailable");
  assert.equal(formatReceiptDate("2026-07-11T12:00:00.000Z"), "Jul 11, 2026");
  assert.equal(formatReceiptDate(null), null);
});
