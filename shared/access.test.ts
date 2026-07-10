import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAccessCapability,
  isStaffRole,
  STAFF_ROLES,
} from "./access.js";

test("access vocabulary contains only approved roles and capabilities", () => {
  assert.deepEqual(STAFF_ROLES, ["employee", "producer"]);
  assert.equal(isStaffRole("employee"), true);
  assert.equal(isStaffRole("producer"), true);
  assert.equal(isStaffRole("admin"), false);
  assert.equal(isAccessCapability("admin"), true);
  assert.equal(isAccessCapability("credit_card_manager"), false);
});
