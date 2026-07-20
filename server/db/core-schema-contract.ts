export const approvedCoreSchemaFingerprint =
  "2e9f37930b5a85aa44f6a77184ba013eda6eb246133e5c02dc2a4d1a91d5fd2b";

export const coreSchemaTables = [
  "approval_queue_entries",
  "audit_events",
  "business_state_control",
  "business_state_generations",
  "carriers",
  "drafts",
  "kpi_targets",
  "login_throttle_buckets",
  "mga_payments",
  "mgas",
  "office_locations",
  "password_reset_tokens",
  "pay_sheet_adjustments",
  "pay_sheet_policies",
  "pay_sheets",
  "policies",
  "policy_change_requests",
  "policy_overrides",
  "policy_types",
  "producer_rate_history",
  "sessions",
  "staff_profiles",
  "user_capabilities",
  "user_mfa_method_placeholders",
  "user_mfa_settings",
  "users",
] as const;

export const forbiddenCoreSchemaTables = [
  "carrier_mga_defaults",
  "export_jobs",
  "migration_batches",
] as const;

export const forbiddenCoreSchemaColumns = [
  "balance_due_from_insured",
  "carrier_fee",
  "remaining_net_due",
] as const;
