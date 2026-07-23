import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POLICY_TYPE_CLASSES,
  policyTypeClassLabel,
} from "./policy-types.js";

test("policy type classes retain stable values with user-facing labels", () => {
  assert.deepEqual(POLICY_TYPE_CLASSES, [
    "Personal",
    "Commercial",
    "Life-Health",
  ]);
  assert.deepEqual(POLICY_TYPE_CLASSES.map(policyTypeClassLabel), [
    "Personal",
    "Commercial",
    "Health",
  ]);
});
