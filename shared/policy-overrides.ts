export const POLICY_OVERRIDE_FIELDS = [
  "commissionAmount",
  "brokerFee",
  "netDue",
  "commissionMode",
] as const;

export type PolicyOverrideField = (typeof POLICY_OVERRIDE_FIELDS)[number];

export const MAX_POLICY_OVERRIDE_VALUES_BYTES = 4_096;
