export const approvedCoreSchemaFingerprint =
  "9cb5a812c7184385acedac39de14fc92e76c2c5d914afb90ee7c0c393e114466";

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
