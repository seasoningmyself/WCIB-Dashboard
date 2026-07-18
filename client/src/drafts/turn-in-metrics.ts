import type { CurrentUser } from "../../../shared/current-user.js";
import type { MyItem } from "../../../shared/my-items.js";
import type { ApiClient } from "../api/client.js";
import { createApprovalApi } from "../approvals/api.js";
import { createPolicyLedgerApi } from "../ledger/api.js";
import { createMgaPayablesApi } from "../mga-payables/api.js";
import { createMyItemsApi } from "../my-items/api.js";

export interface TurnInMetric {
  detail?: string;
  href: string;
  label: string;
  value: number;
}

export async function loadTurnInMetrics(
  client: ApiClient,
  user: Readonly<CurrentUser>,
  now = new Date(),
): Promise<readonly TurnInMetric[]> {
  const allowed = new Set(user.allowedNavigation);
  if (user.role === "admin") {
    const [approvalWork, ledger, payables] = await Promise.all([
      allowed.has("approvals") || allowed.has("help_requests")
        ? createApprovalApi(client).list()
        : Promise.resolve(null),
      allowed.has("policy_ledger")
        ? createPolicyLedgerApi(client).list({ month: monthKey(now) })
        : Promise.resolve(null),
      allowed.has("mga_payables")
        ? createMgaPayablesApi(client).list("unpaid")
        : Promise.resolve(null),
    ]);
    return [
      approvalWork !== null && allowed.has("approvals")
        ? metric("Approvals waiting", approvalWork.submissions.length, "#/approvals")
        : null,
      approvalWork !== null && allowed.has("help_requests")
        ? metric("Help Requests", approvalWork.helpRequests.length, "#/help-requests")
        : null,
      ledger === null
        ? null
        : metric("Policies in ledger", ledger.filteredTotal, "#/policy-ledger", "this month"),
      payables === null
        ? null
        : metric("MGA payables", payables.summary.unpaidCount, "#/mga-payables"),
    ].filter((item): item is TurnInMetric => item !== null);
  }

  if (
    (user.role !== "employee" && user.role !== "producer") ||
    !allowed.has("my_items")
  ) {
    return [];
  }
  const { items } = await createMyItemsApi(client).list();
  return staffTurnInMetrics(items, now);
}

export function staffTurnInMetrics(
  items: readonly MyItem[],
  now = new Date(),
): readonly TurnInMetric[] {
  const today = dayKey(now);
  const counts = {
    draft: 0,
    flagged: 0,
    lifetimeSubmitted: 0,
    sentBack: 0,
    submittedToday: 0,
  };
  for (const item of items) {
    if (item.status === "draft") counts.draft += 1;
    if (item.status === "flagged") counts.flagged += 1;
    if (item.status === "sent_back") counts.sentBack += 1;
    if (item.status === "submitted" || item.status === "approved") {
      counts.lifetimeSubmitted += 1;
    }
    if (
      item.status === "submitted" &&
      item.submittedAt !== null &&
      dayKey(new Date(item.submittedAt)) === today
    ) {
      counts.submittedToday += 1;
    }
  }
  return [
    metric("Drafts", counts.draft, "#/my-drafts?filter=draft"),
    metric(
      "Submitted today",
      counts.submittedToday,
      "#/my-drafts?filter=submitted",
      `lifetime: ${counts.lifetimeSubmitted}`,
    ),
    metric("Waiting on Sophia", counts.flagged, "#/my-drafts?filter=flagged"),
    metric("Sent back", counts.sentBack, "#/my-drafts?filter=sent_back"),
  ];
}

function metric(
  label: string,
  value: number,
  href: string,
  detail?: string,
): TurnInMetric {
  return detail === undefined
    ? { href, label, value }
    : { detail, href, label, value };
}

function monthKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function dayKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
