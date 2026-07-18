import assert from "node:assert/strict";
import { test } from "node:test";
import { accountAssignmentLabel } from "./account-assignment-labels.js";

test("account assignment labels identify people by name without pronouns", () => {
  assert.equal(accountAssignmentLabel("none", null), "Sophia's account");
  assert.equal(accountAssignmentLabel("book", "Kaylee"), "Kaylee's book");
  assert.equal(
    accountAssignmentLabel("book", "Kaylee", "account"),
    "Kaylee's account",
  );
  assert.equal(
    accountAssignmentLabel("house", "Kaylee"),
    "1st-yr house - Kaylee",
  );
  assert.equal(accountAssignmentLabel("book", null), "Producer book");
  assert.equal(accountAssignmentLabel("house", null), "1st-yr house");
});
