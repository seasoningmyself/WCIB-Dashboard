import type { CurrentUser } from "../../../shared/current-user.js";
import type { PaySheetExportQuery } from "../../../shared/pay-sheet-export.js";
import type {
  PaySheetAdjustmentView,
  PaySheetDetail,
  PaySheetPolicyView,
  PaySheetSummary,
} from "../../../shared/pay-sheet-api.js";

export interface PaySheetOwnerGroup {
  key: string;
  label: string;
  ownerType: "producer" | "sophia";
  ownerUserId: string;
  sheets: readonly PaySheetSummary[];
}

export interface PaySheetPeriodOption {
  key: string;
  label: string;
  periodMonth: number;
  periodYear: number;
}

export interface PaySheetPolicySection {
  key: PaySheetPolicyView["kayleeSplit"];
  label: string;
  policies: readonly PaySheetPolicyView[];
  sectionAmount: string | null;
  sectionAmountLabel: "Section payout" | "Section total";
  sectionBrokerFees: string;
  sectionCommissions: string;
}

export function isPaySheetsAdmin(user: CurrentUser): boolean {
  return user.role === "admin" && user.capabilities.includes("admin");
}

export function groupPaySheetsByOwner(
  sheets: readonly PaySheetSummary[],
): readonly PaySheetOwnerGroup[] {
  const groups = new Map<string, PaySheetOwnerGroup>();
  for (const sheet of sheets) {
    const key = `${sheet.ownerType}:${sheet.ownerUserId}`;
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, {
        key,
        label: sheet.ownerDisplayName,
        ownerType: sheet.ownerType,
        ownerUserId: sheet.ownerUserId,
        sheets: [sheet],
      });
    } else {
      groups.set(key, { ...current, sheets: [...current.sheets, sheet] });
    }
  }
  return [...groups.values()];
}

export function openSheetForOwner(
  group: PaySheetOwnerGroup,
): PaySheetSummary | null {
  return group.sheets.find(({ status }) => status === "open") ?? null;
}

export function closedSheetsForOwner(
  group: PaySheetOwnerGroup,
): readonly PaySheetSummary[] {
  return group.sheets.filter(({ status }) => status === "closed");
}

export function listPaySheetPeriods(
  sheets: readonly PaySheetSummary[],
): readonly PaySheetPeriodOption[] {
  const periods = new Map<string, PaySheetPeriodOption>();
  for (const sheet of sheets) {
    const key = paySheetPeriodKey(sheet.periodMonth, sheet.periodYear);
    periods.set(key, {
      key,
      label: formatPaySheetPeriod(sheet.periodMonth, sheet.periodYear),
      periodMonth: sheet.periodMonth,
      periodYear: sheet.periodYear,
    });
  }
  return [...periods.values()].sort(
    (left, right) =>
      right.periodYear - left.periodYear || right.periodMonth - left.periodMonth,
  );
}

export function ownerHasPaySheetPeriod(
  group: PaySheetOwnerGroup,
  period: PaySheetPeriodOption,
): boolean {
  return group.sheets.some(
    (sheet) =>
      sheet.periodMonth === period.periodMonth &&
      sheet.periodYear === period.periodYear,
  );
}

export function paySheetExportQueryForScope(
  scope: "all" | "owner",
  group: PaySheetOwnerGroup,
  period: PaySheetPeriodOption,
): PaySheetExportQuery | null {
  if (scope === "owner" && !ownerHasPaySheetPeriod(group, period)) return null;
  return {
    ownerUserId: scope === "owner" ? group.ownerUserId : null,
    periodMonth: period.periodMonth,
    periodYear: period.periodYear,
  };
}

export function paySheetPeriodKey(periodMonth: number, periodYear: number): string {
  return `${periodYear}-${String(periodMonth).padStart(2, "0")}`;
}

export function formatPaySheetPeriod(
  periodMonth: number,
  periodYear: number,
): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(periodYear, periodMonth - 1, 1)));
}

export function formatPaySheetDate(value: string | null): string {
  if (value === null) return "Not closed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function formatPaySheetRate(value: string): string {
  return `${value}%`;
}

export function paySheetAccountLabel(
  value: PaySheetAdjustmentView["accountBasis"],
  producerDisplayName: string | null,
): string {
  if (value === "own") return "Sophia own account";
  const producer = producerDisplayName ?? "Producer";
  return value === "house" ? `${producer} first year` : `${producer} account`;
}

export function groupPaySheetPolicies(
  sheet: Pick<PaySheetDetail, "ownerType" | "policies">,
): readonly PaySheetPolicySection[] {
  const definitions = sheet.ownerType === "sophia"
    ? [
        ["none", "House"],
        ["book", "Producers' book"],
        ["house", "1st-yr house"],
      ] as const
    : [
        ["book", "Their book"],
        ["house", "1st-yr house"],
      ] as const;

  return definitions.flatMap(([key, label]) => {
    const policies = sheet.policies
      .filter(({ kayleeSplit }) => kayleeSplit === key)
      .sort((left, right) =>
        left.insuredName.localeCompare(right.insuredName, "en", {
          sensitivity: "base",
        }) || left.associationId.localeCompare(right.associationId));
    if (policies.length === 0) return [];
    const sectionBrokerFees = sumExactMoney(
      policies.map(({ brokerFee }) => brokerFee),
    );
    const sectionCommissions = sumExactMoney(
      policies.map(({ commissionAmount }) => commissionAmount),
    );
    const sectionAmount = sheet.ownerType === "sophia"
      ? addExactMoney(sectionBrokerFees, sectionCommissions)
      : policies.some(({ producerPayout }) => producerPayout === null)
        ? null
        : sumExactMoney(
            policies.map(({ producerPayout }) => producerPayout ?? "0.00"),
          );
    return [{
      key,
      label,
      policies,
      sectionAmount,
      sectionAmountLabel:
        sheet.ownerType === "sophia" ? "Section total" : "Section payout",
      sectionBrokerFees,
      sectionCommissions,
    }];
  });
}

export function adjustmentTypeLabel(
  value: PaySheetAdjustmentView["adjustmentType"],
): string {
  switch (value) {
    case "ach_income":
      return "ACH income";
    case "chargeback":
      return "Chargeback";
    case "check_income":
      return "Check income";
    case "direct_deposit":
      return "Direct deposit";
    case "manual_adjustment":
      return "Manual adjustment";
  }
}

export function isDirectIncomeAdjustment(
  value: PaySheetAdjustmentView["adjustmentType"],
): boolean {
  return (
    value === "ach_income" ||
    value === "check_income" ||
    value === "direct_deposit"
  );
}

export function detailSourceLabel(sheet: PaySheetDetail): string {
  return sheet.status === "closed" ? "Frozen history" : "Current values";
}

function sumExactMoney(values: readonly string[]): string {
  return formatCents(
    values.reduce((total, value) => total + parseCents(value), 0n),
  );
}

function addExactMoney(left: string, right: string): string {
  return formatCents(parseCents(left) + parseCents(right));
}

function parseCents(value: string): bigint {
  const match = /^(0|[1-9][0-9]{0,11})\.([0-9]{2})$/.exec(value);
  if (match === null) throw new Error("Projected pay-sheet money is invalid");
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function formatCents(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}
