export const AUDIT_ACTIONS = [
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
  "draft_flagged",
  "draft_help_withdrawn",
  "draft_sent_back",
  "policy_approved",
  "admin_policy_submitted",
  "policy_corrected",
  "carrier_created",
  "policy_type_created",
  "mga_created",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
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
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const MAX_AUDIT_SUMMARY_BYTES = 16_384;
export const MAX_AUDIT_SUMMARY_FIELDS = 32;
export const MAX_AUDIT_SUMMARY_STRING_LENGTH = 500;
