import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalWorkListResponseSchema,
  listApprovalWorkQuerySchema,
} from "./approval-queue.js";

test("approval work filters are bounded and default to the active queue", () => {
  assert.deepEqual(listApprovalWorkQuerySchema.parse({}), { status: "all" });
  assert.deepEqual(listApprovalWorkQuerySchema.parse({ status: "pending" }), {
    status: "pending",
  });
  assert.throws(() =>
    listApprovalWorkQuerySchema.parse({ status: "approved" }),
  );
  assert.throws(() =>
    listApprovalWorkQuerySchema.parse({ status: "all", ownerUserId: "x" }),
  );
});

test("approval work responses reject undeclared queue and help fields", () => {
  assert.throws(() =>
    approvalWorkListResponseSchema.parse({
      helpRequests: [],
      rawPolicyTotals: "1000.00",
      submissions: [],
    }),
  );
});
