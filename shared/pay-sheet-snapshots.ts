export const PAY_SHEET_POLICY_SNAPSHOT_FIELDS = [
  "policyId",
  "insuredName",
  "policyNumber",
  "policyTypeName",
  "policyTypeClass",
  "transactionType",
  "effectiveDate",
  "approvedAt",
  "producerUserId",
  "officeLocationId",
  "kayleeSplit",
  "commissionAmount",
  "brokerFee",
  "agencyRevenue",
  "producerPayout",
  "sophiaShare",
] as const;

export const PAY_SHEET_RATE_SNAPSHOT_FIELDS = [
  "effectiveDate",
  "newCommissionRate",
  "newBrokerRate",
  "renewalCommissionRate",
  "renewalBrokerRate",
] as const;

export const MAX_PAY_SHEET_POLICY_SNAPSHOT_BYTES = 8_192;
export const MAX_PAY_SHEET_RATE_SNAPSHOT_BYTES = 2_048;

export type PaySheetPolicySnapshotField =
  (typeof PAY_SHEET_POLICY_SNAPSHOT_FIELDS)[number];
export type PaySheetRateSnapshotField =
  (typeof PAY_SHEET_RATE_SNAPSHOT_FIELDS)[number];

export type PaySheetPolicySnapshot = Readonly<
  Omit<Record<PaySheetPolicySnapshotField, string>, "producerUserId"> & {
    producerUserId: string | null;
  }
>;

export type PaySheetRateSnapshot = Readonly<
  Record<PaySheetRateSnapshotField, string>
>;
