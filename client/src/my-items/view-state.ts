import type { CurrentUser } from "../../../shared/current-user.js";
import {
  MY_ITEM_STATUSES,
  type MyItem,
} from "../../../shared/my-items.js";

export const MY_ITEM_FILTERS = ["all", ...MY_ITEM_STATUSES] as const;
export type MyItemFilter = (typeof MY_ITEM_FILTERS)[number];

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

export function isEditableMyItem(item: MyItem): boolean {
  return item.status === "draft" || item.status === "sent_back";
}
