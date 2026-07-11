export const approvedCoreSchemaFingerprint =
  "659a71d803b72358cb237760eaa952df8bf9da23d23f4276f1a232c47664931e";

export const coreSchemaTables = [
  "approval_queue_entries",
  "audit_events",
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
