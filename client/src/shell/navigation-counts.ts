import type {
  AppNavigationId,
  CurrentUser,
} from "../../../shared/current-user.js";
import type { ApprovalWorkListResponse } from "../../../shared/approval-queue.js";
import type { MyCommissionsResponse } from "../../../shared/my-commissions.js";
import type { MyItemsResponse } from "../../../shared/my-items.js";
import type { ApiClient } from "../api/client.js";
import { createApprovalApi } from "../approvals/api.js";
import { createMyCommissionsApi } from "../commissions/api.js";
import { createMyItemsApi } from "../my-items/api.js";

export type NavigationCounts = Partial<
  Readonly<Record<AppNavigationId, number>>
>;

export async function loadNavigationCounts(
  client: ApiClient,
  user: Readonly<CurrentUser>,
): Promise<NavigationCounts> {
  const allowed = new Set(user.allowedNavigation);
  const approvalWorkPromise =
    user.role === "admin" &&
    (allowed.has("approvals") || allowed.has("help_requests"))
      ? createApprovalApi(client).list().catch(() => null)
      : Promise.resolve(null);
  const myItemsPromise =
    (user.role === "employee" || user.role === "producer") &&
    allowed.has("my_items")
      ? createMyItemsApi(client).list().catch(() => null)
      : Promise.resolve(null);
  const myCommissionsPromise =
    user.role === "producer" && allowed.has("my_commissions")
      ? createMyCommissionsApi(client)
          .list({ search: "", sort: "insured" })
          .catch(() => null)
      : Promise.resolve(null);

  const [approvalWork, myItems, myCommissions] = await Promise.all([
    approvalWorkPromise,
    myItemsPromise,
    myCommissionsPromise,
  ]);
  return navigationCountsFromProjectedData({
    approvalWork,
    myCommissions,
    myItems,
  });
}

export function navigationCountsFromProjectedData({
  approvalWork,
  myCommissions,
  myItems,
}: {
  approvalWork: ApprovalWorkListResponse | null;
  myCommissions: MyCommissionsResponse | null;
  myItems: MyItemsResponse | null;
}): NavigationCounts {
  return {
    ...(approvalWork === null
      ? {}
      : {
          approvals: approvalWork.submissions.length,
          help_requests: approvalWork.helpRequests.length,
        }),
    ...(myItems === null
      ? {}
      : {
          my_items: myItems.items.filter(
            (item) => item.status === "sent_back",
          ).length,
        }),
    ...(myCommissions === null
      ? {}
      : { my_commissions: myCommissions.summary.owedCount }),
  };
}

export function visibleNavigationCount(
  counts: NavigationCounts,
  id: AppNavigationId,
): number | null {
  const count = counts[id];
  return count === undefined || !Number.isSafeInteger(count) || count <= 0
    ? null
    : count;
}
