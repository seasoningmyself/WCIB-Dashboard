import { accountAssignmentLabel } from "../../../shared/account-assignment-labels.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  MgaPayableGroup,
  MgaPayableItem,
} from "../../../shared/mga-payables.js";
import { ageInWholeDays } from "../ui/time.js";

export interface PayableAging {
  label: string;
  tone: "danger" | "warning";
}

export function isMgaPayablesAdmin(user: CurrentUser): boolean {
  return user.role === "admin" && user.capabilities.includes("admin");
}

export function payableAccountLabel(item: MgaPayableItem): string {
  return accountAssignmentLabel(item.kayleeSplit, item.producerDisplayName);
}

export function payableGroupAction(group: MgaPayableGroup): {
  count: number;
  label: "Mark all paid" | "Unmark all";
  status: "paid" | "unpaid";
} {
  const fullyPaid = group.totals.paidCount === group.totals.totalCount;
  return fullyPaid
    ? {
        count: group.totals.paidCount,
        label: "Unmark all",
        status: "unpaid",
      }
    : {
        count: group.totals.unpaidCount,
        label: "Mark all paid",
        status: "paid",
      };
}

export function payableAging(
  item: MgaPayableItem,
  now = new Date(),
): PayableAging | null {
  if (item.status === "paid") return null;
  const days = ageInWholeDays(item.approvedAt, now);
  if (days === null) return null;
  if (days >= 60) {
    return { label: `${days}d outstanding`, tone: "danger" };
  }
  if (days >= 30) {
    return { label: `${days}d outstanding`, tone: "warning" };
  }
  return null;
}

export function oldestOutstandingDays(
  group: MgaPayableGroup,
  now = new Date(),
): number | null {
  const ages = group.items.flatMap((item) => {
    if (item.status === "paid") return [];
    const age = ageInWholeDays(item.approvedAt, now);
    return age === null ? [] : [age];
  });
  return ages.length === 0 ? null : Math.max(...ages);
}

export function outstandingShare(
  outstandingAmount: string,
  totalOutstandingAmount: string,
): string {
  const amount = moneyToCents(outstandingAmount);
  const total = moneyToCents(totalOutstandingAmount);
  if (amount === null || total === null || total === 0n) return "0%";
  const tenths = Number((amount * 1_000n + total / 2n) / total);
  return `${(tenths / 10).toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: tenths % 10 === 0 ? 0 : 1,
  })}%`;
}

export function formatPayableDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function formatPayableCommissionRate(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/0+$/, "").replace(/\.$/, "");
  return normalized === "0" ? null : `${normalized}%`;
}

function moneyToCents(value: string): bigint | null {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return BigInt(match[1]) * 100n + BigInt(match[2]);
}
