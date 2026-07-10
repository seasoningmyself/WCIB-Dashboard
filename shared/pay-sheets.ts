export const PAY_SHEET_OWNER_TYPES = ["sophia", "producer"] as const;
export const PAY_SHEET_STATUSES = ["open", "closed"] as const;

export const PAY_SHEET_COMMON_TOTAL_FIELDS = [
  "brokerFees",
  "commissions",
  "trustPull",
  "directCheckAchIncome",
  "grandTotalIncome",
] as const;

export const PAY_SHEET_SOPHIA_TOTAL_FIELDS = [
  ...PAY_SHEET_COMMON_TOTAL_FIELDS,
  "sophiaTakeHome",
  "sophiaShare",
  "sophiaAgencyGross",
] as const;

export const PAY_SHEET_PRODUCER_TOTAL_FIELDS = [
  ...PAY_SHEET_COMMON_TOTAL_FIELDS,
  "producerPayout",
] as const;

export const MAX_PAY_SHEET_FROZEN_TOTALS_BYTES = 4_096;

export type PaySheetOwnerType = (typeof PAY_SHEET_OWNER_TYPES)[number];
export type PaySheetStatus = (typeof PAY_SHEET_STATUSES)[number];
export type PaySheetSophiaTotalField =
  (typeof PAY_SHEET_SOPHIA_TOTAL_FIELDS)[number];
export type PaySheetProducerTotalField =
  (typeof PAY_SHEET_PRODUCER_TOTAL_FIELDS)[number];

export type PaySheetSophiaFrozenTotals = Readonly<
  Record<PaySheetSophiaTotalField, string>
>;
export type PaySheetProducerFrozenTotals = Readonly<
  Record<PaySheetProducerTotalField, string>
>;
export type PaySheetFrozenTotals =
  | PaySheetSophiaFrozenTotals
  | PaySheetProducerFrozenTotals;
