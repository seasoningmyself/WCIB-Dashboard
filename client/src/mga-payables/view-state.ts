import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  MgaPayableGroup,
  MgaPayableItem,
} from "../../../shared/mga-payables.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PayableAging {
  label: string;
  tone: "danger" | "warning";
}

export function isMgaPayablesAdmin(user: CurrentUser): boolean {
  return user.role === "admin" && user.capabilities.includes("admin");
}

export function payableAccountLabel(item: MgaPayableItem): string {
  if (item.kayleeSplit === "none") return "Sophia house";
  const producer = item.producerDisplayName ?? "Producer";
  return item.kayleeSplit === "house"
    ? `${producer} first year`
    : `${producer} account`;
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
  const approvedAt = new Date(item.approvedAt);
  if (Number.isNaN(approvedAt.getTime()) || Number.isNaN(now.getTime())) {
    return null;
  }
  const days = Math.max(
    0,
    Math.floor((now.getTime() - approvedAt.getTime()) / DAY_MS),
  );
  if (days >= 60) {
    return { label: `${days}d overdue`, tone: "danger" };
  }
  if (days >= 30) {
    return { label: `${days}d`, tone: "warning" };
  }
  return null;
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
