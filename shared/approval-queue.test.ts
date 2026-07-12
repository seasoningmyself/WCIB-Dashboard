import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalSendBackRequestSchema,
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

test("approval send-back reasons are trimmed, bounded, and reason-only", () => {
  assert.deepEqual(
    approvalSendBackRequestSchema.parse({ reason: "  Correct the MGA  " }),
    { reason: "Correct the MGA" },
  );
  for (const input of [
    {},
    { reason: "   " },
    { reason: "x".repeat(501) },
    { reason: "No", status: "sent_back" },
  ]) {
    assert.equal(approvalSendBackRequestSchema.safeParse(input).success, false);
  }
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
