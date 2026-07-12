import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import { myItem, uuid } from "./test-fixture.js";
import {
  countMyItems,
  filterMyItems,
  isEditableMyItem,
  isMyItemsStaff,
  myItemFilterLabel,
} from "./view-state.js";

const employee: CurrentUser = {
  allowedNavigation: ["turn_in", "my_items"],
  capabilities: [],
  displayName: "Mercedes",
  email: "mercedes@example.test",
  id: uuid(9),
  role: "employee",
};

test("My Items filtering and counts cover every workflow status", () => {
  const items = [
    myItem(),
    myItem({ id: uuid(2), status: "submitted" }),
    myItem({ id: uuid(3), status: "flagged" }),
    myItem({ id: uuid(4), status: "sent_back" }),
    myItem({ id: uuid(5), status: "approved" }),
  ];
  assert.deepEqual(countMyItems(items), {
    all: 5,
    approved: 1,
    draft: 1,
    flagged: 1,
    sent_back: 1,
    submitted: 1,
  });
  assert.deepEqual(filterMyItems(items, "flagged"), [items[2]]);
  assert.equal(myItemFilterLabel("flagged"), "Waiting on Sophia");
});

test("My Items access and editability stay explicit", () => {
  assert.equal(isMyItemsStaff(employee), true);
  assert.equal(isMyItemsStaff({ ...employee, role: "producer" }), true);
  assert.equal(isMyItemsStaff({ ...employee, role: "admin" }), false);
  assert.equal(
    isMyItemsStaff({ ...employee, allowedNavigation: ["turn_in"] }),
    false,
  );
  assert.equal(isEditableMyItem(myItem()), true);
  assert.equal(isEditableMyItem(myItem({ status: "sent_back" })), true);
  assert.equal(isEditableMyItem(myItem({ status: "submitted" })), false);
});
