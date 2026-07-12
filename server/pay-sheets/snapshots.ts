import { ACCOUNT_ASSIGNMENTS } from "../../shared/policy-fields.js";
import { POLICY_TYPE_CLASSES } from "../../shared/policy-types.js";
import {
  MAX_PAY_SHEET_POLICY_SNAPSHOT_BYTES,
  MAX_PAY_SHEET_RATE_SNAPSHOT_BYTES,
  PAY_SHEET_POLICY_SNAPSHOT_FIELDS,
  PAY_SHEET_RATE_SNAPSHOT_FIELDS,
  type PaySheetPolicySnapshot,
  type PaySheetRateSnapshot,
} from "../../shared/pay-sheet-snapshots.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const moneyPattern = /^(0|[1-9][0-9]{0,11})\.([0-9]{2})$/;
const ratePattern = /^(0|[1-9][0-9]{0,2})\.([0-9]{2})$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function buildPaySheetPolicySnapshot(
  source: Readonly<Record<string, unknown>>,
): PaySheetPolicySnapshot {
  const commissionAmount = requireMoney(source, "commissionAmount");
  const brokerFee = requireMoney(source, "brokerFee");
  const snapshot: PaySheetPolicySnapshot = Object.freeze({
    policyId: requireUuid(source, "policyId"),
    insuredName: requireText(source, "insuredName", 500),
    policyNumber: requireText(source, "policyNumber", 100),
    policyTypeName: requireText(source, "policyTypeName", 200),
    policyTypeClass: requireChoice(
      source,
      "policyTypeClass",
      POLICY_TYPE_CLASSES,
    ),
    transactionType: requireText(source, "transactionType", 100),
    effectiveDate: requireDate(source, "effectiveDate"),
    approvedAt: requireTimestamp(source, "approvedAt"),
    producerUserId: requireNullableUuid(source, "producerUserId"),
    officeLocationId: requireUuid(source, "officeLocationId"),
    kayleeSplit: requireChoice(source, "kayleeSplit", ACCOUNT_ASSIGNMENTS),
    commissionAmount,
    brokerFee,
    agencyRevenue: formatMoney(
      parseMoney(commissionAmount) + parseMoney(brokerFee),
    ),
    producerPayout: requireMoney(source, "producerPayout"),
    sophiaShare: requireMoney(source, "sophiaShare"),
  });

  if (
    Buffer.byteLength(JSON.stringify(snapshot), "utf8") >
    MAX_PAY_SHEET_POLICY_SNAPSHOT_BYTES
  ) {
    throw new Error("Policy snapshot exceeds the byte limit");
  }
  return snapshot;
}

export function parsePaySheetPolicySnapshot(
  value: unknown,
): PaySheetPolicySnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Policy snapshot is missing or invalid");
  }
  const source = value as Readonly<Record<string, unknown>>;
  const actualFields = Object.keys(source).sort();
  const expectedFields = [...PAY_SHEET_POLICY_SNAPSHOT_FIELDS].sort();
  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new Error("Policy snapshot fields are missing or invalid");
  }

  const snapshot = buildPaySheetPolicySnapshot(source);
  if (source.agencyRevenue !== snapshot.agencyRevenue) {
    throw new Error("Policy snapshot money is missing or invalid: agencyRevenue");
  }
  return snapshot;
}

export function buildPaySheetRateSnapshot(
  source: Readonly<Record<string, unknown>>,
): PaySheetRateSnapshot {
  const snapshot: PaySheetRateSnapshot = Object.freeze({
    effectiveDate: requireDate(source, "effectiveDate"),
    newCommissionRate: requireRate(source, "newCommissionRate"),
    newBrokerRate: requireRate(source, "newBrokerRate"),
    renewalCommissionRate: requireRate(source, "renewalCommissionRate"),
    renewalBrokerRate: requireRate(source, "renewalBrokerRate"),
  });

  if (
    Buffer.byteLength(JSON.stringify(snapshot), "utf8") >
    MAX_PAY_SHEET_RATE_SNAPSHOT_BYTES
  ) {
    throw new Error("Rate snapshot exceeds the byte limit");
  }
  return snapshot;
}

export function parsePaySheetRateSnapshot(
  value: unknown,
): PaySheetRateSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Rate snapshot is missing or invalid");
  }
  const source = value as Readonly<Record<string, unknown>>;
  const actualFields = Object.keys(source).sort();
  const expectedFields = [...PAY_SHEET_RATE_SNAPSHOT_FIELDS].sort();
  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new Error("Rate snapshot fields are missing or invalid");
  }
  return buildPaySheetRateSnapshot(source);
}

function requireText(
  source: Readonly<Record<string, unknown>>,
  field: string,
  maxLength: number,
): string {
  const value = source[field];
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`Snapshot field is missing or invalid: ${field}`);
  }
  return value;
}

function requireUuid(
  source: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = source[field];
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error(`Snapshot UUID is missing or invalid: ${field}`);
  }
  return value;
}

function requireNullableUuid(
  source: Readonly<Record<string, unknown>>,
  field: string,
): string | null {
  const value = source[field];
  if (value === null) {
    return null;
  }
  return requireUuid(source, field);
}

function requireChoice<T extends string>(
  source: Readonly<Record<string, unknown>>,
  field: string,
  choices: readonly T[],
): T {
  const value = source[field];
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`Snapshot field is outside its vocabulary: ${field}`);
  }
  return value as T;
}

function requireDate(
  source: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = source[field];
  if (typeof value !== "string" || !datePattern.test(value)) {
    throw new Error(`Snapshot date is missing or invalid: ${field}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Snapshot date is missing or invalid: ${field}`);
  }
  return value;
}

function requireTimestamp(
  source: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = source[field];
  const timestamp = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Snapshot timestamp is missing or invalid: ${field}`);
  }
  const normalized = timestamp.toISOString();
  if (typeof value === "string" && value !== normalized) {
    throw new Error(`Snapshot timestamp is missing or invalid: ${field}`);
  }
  return normalized;
}

function requireMoney(
  source: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = source[field];
  if (typeof value !== "string" || !moneyPattern.test(value)) {
    throw new Error(`Snapshot money is missing or invalid: ${field}`);
  }
  return value;
}

function requireRate(
  source: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = source[field];
  if (
    typeof value !== "string" ||
    !ratePattern.test(value) ||
    parseMoney(value) > 10_000n
  ) {
    throw new Error(`Snapshot rate is missing or invalid: ${field}`);
  }
  return value;
}

function parseMoney(value: string): bigint {
  const [whole, fraction] = value.split(".");
  return BigInt(whole ?? "0") * 100n + BigInt(fraction ?? "0");
}

function formatMoney(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
