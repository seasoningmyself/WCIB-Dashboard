import {
  MAX_PAY_SHEET_FROZEN_TOTALS_BYTES,
  PAY_SHEET_PRODUCER_TOTAL_FIELDS,
  PAY_SHEET_SOPHIA_TOTAL_FIELDS,
  type PaySheetFrozenTotals,
  type PaySheetOwnerType,
  type PaySheetProducerFrozenTotals,
  type PaySheetSophiaFrozenTotals,
} from "../../shared/pay-sheets.js";

const moneyPattern = /^(-?)(0|[1-9][0-9]{0,11})\.([0-9]{2})$/;

export function buildPaySheetFrozenTotals(
  ownerType: "sophia",
  source: Readonly<Record<string, unknown>>,
): PaySheetSophiaFrozenTotals;
export function buildPaySheetFrozenTotals(
  ownerType: "producer",
  source: Readonly<Record<string, unknown>>,
): PaySheetProducerFrozenTotals;
export function buildPaySheetFrozenTotals(
  ownerType: PaySheetOwnerType,
  source: Readonly<Record<string, unknown>>,
): PaySheetFrozenTotals {
  const fields =
    ownerType === "sophia"
      ? PAY_SHEET_SOPHIA_TOTAL_FIELDS
      : PAY_SHEET_PRODUCER_TOTAL_FIELDS;
  const sourceKeys = Object.keys(source).sort();
  const expectedKeys = [...fields].sort();

  if (
    sourceKeys.length !== expectedKeys.length ||
    sourceKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Frozen totals must match the owner-specific field contract");
  }

  const totals: Record<string, string> = {};
  for (const field of fields) {
    const value = source[field];
    if (typeof value !== "string" || !moneyPattern.test(value)) {
      throw new Error(`Frozen total must be canonical money: ${field}`);
    }
    if (value === "-0.00") {
      throw new Error(`Frozen total cannot be negative zero: ${field}`);
    }
    totals[field] = value;
  }

  if (
    parseMoney(totals.trustPull) !==
    parseMoney(totals.brokerFees) + parseMoney(totals.commissions)
  ) {
    throw new Error("Trust pull must equal broker fees plus commissions");
  }
  if (
    parseMoney(totals.grandTotalIncome) !==
    parseMoney(totals.trustPull) + parseMoney(totals.directCheckAchIncome)
  ) {
    throw new Error("Grand total income must equal trust plus direct income");
  }
  if (
    ownerType === "sophia" &&
    parseMoney(totals.sophiaAgencyGross) !==
      parseMoney(totals.grandTotalIncome)
  ) {
    throw new Error("Sophia agency gross must equal grand total income");
  }
  if (
    Buffer.byteLength(JSON.stringify(totals), "utf8") >
    MAX_PAY_SHEET_FROZEN_TOTALS_BYTES
  ) {
    throw new Error("Frozen totals exceed the byte limit");
  }

  return Object.freeze(totals) as PaySheetFrozenTotals;
}

function parseMoney(value: string): bigint {
  const match = moneyPattern.exec(value);
  if (match === null) {
    throw new Error("Frozen total is not canonical money");
  }
  const sign = match[1] === "-" ? -1n : 1n;
  return sign * (BigInt(match[2]) * 100n + BigInt(match[3]));
}
