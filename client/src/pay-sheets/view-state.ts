import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  PaySheetAdjustmentView,
  PaySheetDetail,
  PaySheetSummary,
} from "../../../shared/pay-sheet-api.js";

export interface PaySheetOwnerGroup {
  key: string;
  label: string;
  ownerType: "producer" | "sophia";
  ownerUserId: string;
  sheets: readonly PaySheetSummary[];
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
