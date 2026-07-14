import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPolicyChangeRequestSchema,
  ownerPolicyChangeRequestSchema,
  sendBackPolicyChangeRequestSchema,
} from "./policy-change-requests.js";

test("policy change requests accept only a bounded reason", () => {
  assert.deepEqual(createPolicyChangeRequestSchema.parse({ reason: "  Fix name  " }), {
    reason: "Fix name",
  });
  assert.equal(createPolicyChangeRequestSchema.safeParse({ reason: " " }).success, false);
  assert.equal(
    createPolicyChangeRequestSchema.safeParse({ reason: "x".repeat(501) }).success,
    false,
  );
  assert.equal(
    sendBackPolicyChangeRequestSchema.safeParse({ reason: "Needs details" }).success,
    true,
  );
  assert.equal(
    createPolicyChangeRequestSchema.safeParse({
      reason: "Reason",
      replacementValues: { commissionAmount: "999.00" },
    }).success,
    false,
  );
});

test("owner projection contract excludes actor and correction linkage", () => {
  const unsafe = {
    id: "00000000-0000-4000-8000-000000000001",
    mutationId: null,
    mutationKind: null,
    policyId: "00000000-0000-4000-8000-000000000002",
    reason: "Please review",
    requestedAt: "2026-07-14T18:00:00.000Z",
    requestedByUserId: "00000000-0000-4000-8000-000000000003",
    resolution: null,
    resolutionReason: null,
    resolvedAt: null,
    resolvedByUserId: null,
    status: "pending",
  };
  assert.equal(ownerPolicyChangeRequestSchema.safeParse(unsafe).success, false);
  const { mutationId, mutationKind, requestedByUserId, resolvedByUserId, ...safe } =
    unsafe;
  void mutationId;
  void mutationKind;
  void requestedByUserId;
  void resolvedByUserId;
  assert.equal(ownerPolicyChangeRequestSchema.safeParse(safe).success, true);
});
