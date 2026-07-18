export const approvedCoreSchemaFingerprint =
  "0185cf8f1e925f2255f565e7b4e71e99e9db7eae3551518241af40f56cbc7553";

export const coreSchemaTables = [
  "approval_queue_entries",
  "audit_events",
  "business_state_control",
  "business_state_generations",
  "carriers",
  "drafts",
  "kpi_targets",
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
