import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  MyCommissionItem,
  MyCommissionsResponse,
} from "../../../shared/my-commissions.js";

export interface MyCommissionSections {
  inReview: readonly MyCommissionItem[];
  owed: readonly MyCommissionItem[];
  paid: readonly MyCommissionItem[];
}

export function isMyCommissionsProducer(user: CurrentUser): boolean {
  return (
    user.role === "producer" &&
    user.allowedNavigation.includes("my_commissions")
  );
}

export function groupMyCommissionItems(
  data: MyCommissionsResponse,
): MyCommissionSections {
  return {
    inReview: data.items.filter((item) => item.section === "in_review"),
    owed: data.items.filter((item) => item.section === "owed"),
    paid: data.items.filter((item) => item.section === "paid"),
  };
}

export function formatCommissionMoney(value: string | null): string {
  if (value === null) return "Unavailable";
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (match === null) return "Unavailable";
  const grouped = match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}.${match[2]}`;
}

export function formatReceiptDate(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
