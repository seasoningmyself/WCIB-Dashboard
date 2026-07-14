import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "./audit-events.js";

test("audit vocabulary covers every named sensitive mutation contract", () => {
  const expectedActions = [
    "policy_override_applied",
    "mga_payment_marked_paid",
    "mga_payment_marked_unpaid",
    "mga_payment_sheet_attached",
    "mga_payment_sheet_detached",
    "pay_sheet_closed",
    "pay_sheet_adjustment_created",
    "pay_sheet_adjustment_updated",
    "pay_sheet_adjustment_deleted",
    "staff_account_changed",
    "producer_rate_changed",
    "draft_submitted",
    "draft_submission_withdrawn",
    "draft_flagged",
    "draft_help_withdrawn",
    "draft_sent_back",
    "policy_approved",
    "admin_policy_submitted",
    "policy_corrected",
    "carrier_created",
    "policy_type_created",
    "mga_created",
    "producer_commission_receipt_marked",
    "producer_commission_receipt_unmarked",
    "pay_sheet_initialized",
  ] as const;

  assert.deepEqual(AUDIT_ACTIONS, expectedActions);
  assert.equal(new Set(AUDIT_ACTIONS).size, AUDIT_ACTIONS.length);

  for (const entityType of [
    "policy",
    "policy_override",
    "mga_payment",
    "pay_sheet",
    "pay_sheet_policy",
    "pay_sheet_adjustment",
    "staff_profile",
    "producer_rate_history",
    "draft",
    "approval_queue_entry",
    "carrier",
    "policy_type",
    "mga",
  ]) {
    assert.equal(
      AUDIT_ENTITY_TYPES.includes(entityType as never),
      true,
      entityType,
    );
  }
});
