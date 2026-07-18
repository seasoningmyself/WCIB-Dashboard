import type { CurrentUser } from "../../../shared/current-user.js";
import {
  MY_ITEM_STATUSES,
  type MyItem,
} from "../../../shared/my-items.js";

export const MY_ITEM_FILTERS = ["all", ...MY_ITEM_STATUSES] as const;
export type MyItemFilter = (typeof MY_ITEM_FILTERS)[number];

export function myItemFilterFromPath(path: string): MyItemFilter {
  const query = path.split("?", 2)[1]?.split("#", 1)[0] ?? "";
  const filter = new URLSearchParams(query).get("filter");
  return MY_ITEM_FILTERS.includes(filter as MyItemFilter)
    ? filter as MyItemFilter
    : "all";
}

export function isMyItemsStaff(user: CurrentUser): boolean {
  return (
    (user.role === "employee" || user.role === "producer") &&
    user.allowedNavigation.includes("my_items")
  );
}

export function filterMyItems(
  items: readonly MyItem[],
  filter: MyItemFilter,
): readonly MyItem[] {
  return filter === "all"
    ? items
    : items.filter(({ status }) => status === filter);
}

export function countMyItems(
  items: readonly MyItem[],
): Record<MyItemFilter, number> {
  const counts: Record<MyItemFilter, number> = {
    all: items.length,
    approved: 0,
    draft: 0,
    flagged: 0,
    sent_back: 0,
    submitted: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

export function myItemFilterLabel(filter: MyItemFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "draft":
      return "Drafts";
    case "submitted":
      return "Submitted";
    case "flagged":
      return "Waiting on Sophia";
    case "sent_back":
      return "Sent back";
    case "approved":
      return "Approved";
  }
}

export function myItemStatusLabel(status: MyItem["status"]): string {
  return status === "flagged"
    ? "Waiting on Sophia"
    : myItemFilterLabel(status);
}

export function myItemOpenLabel(item: MyItem): string {
  switch (item.status) {
    case "draft":
      return "Continue draft";
    case "submitted":
      return "View submission";
    case "flagged":
      return "View help request";
    case "sent_back":
      return "Review changes";
    case "approved":
      return "View approved item";
  }
}

export function myItemAgeLabel(
  value: string,
  now = new Date(),
): string {
  const timestamp = new Date(value);
  const elapsedMinutes = Math.max(
    0,
    Math.floor((now.getTime() - timestamp.getTime()) / 60_000),
  );
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) {
    return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
  }
  return new Intl.DateTimeFormat("en-US").format(timestamp);
}
