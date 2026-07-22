export const approvedCoreSchemaFingerprint =
  "a8a02c5d60d29136b7a0a28202ae97e05dfdf423d3c8e40440d18e3c60617ebf";

export const coreSchemaTables = [
  "approval_queue_entries",
  "audit_events",
  "business_state_control",
  "business_state_generations",
  "carriers",
  "drafts",
  "kpi_targets",
  "login_throttle_buckets",
  "mfa_challenges",
  "mfa_recovery_grants",
  "mfa_step_up_authorizations",
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
  "user_mfa_methods",
  "user_mfa_recovery_codes",
  "user_mfa_settings",
  "user_totp_credentials",
  "user_webauthn_credential_transports",
  "user_webauthn_credentials",
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
