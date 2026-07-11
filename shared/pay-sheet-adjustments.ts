export const PAY_SHEET_ADJUSTMENT_TYPES = [
  "chargeback",
  "manual_adjustment",
  "direct_deposit",
  "check_income",
  "ach_income",
] as const;

export const PAY_SHEET_ACCOUNT_BASES = ["own", "book", "house"] as const;

export type PaySheetAdjustmentType =
  (typeof PAY_SHEET_ADJUSTMENT_TYPES)[number];
export type PaySheetAccountBasis = (typeof PAY_SHEET_ACCOUNT_BASES)[number];
