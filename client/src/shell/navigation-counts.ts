import type {
  AppNavigationId,
  CurrentUser,
} from "../../../shared/current-user.js";
import type { ApprovalWorkListResponse } from "../../../shared/approval-queue.js";
import type { MyCommissionsResponse } from "../../../shared/my-commissions.js";
import type { MyItemsResponse } from "../../../shared/my-items.js";
import type { MgaPayableListResponse } from "../../../shared/mga-payables.js";
import type { PaySheetListResponse } from "../../../shared/pay-sheet-api.js";
import type { ApiClient } from "../api/client.js";
import { createApprovalApi } from "../approvals/api.js";
import { createMyCommissionsApi } from "../commissions/api.js";
import { createMgaPayablesApi } from "../mga-payables/api.js";
import { createMyItemsApi } from "../my-items/api.js";
import { createPaySheetsApi } from "../pay-sheets/api.js";

export type NavigationCounts = Partial<
  Readonly<Record<AppNavigationId, number>>
> &
  Readonly<{
    policy_change_requests?: number;
  }>;

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
  const mgaPayablesPromise =
    user.role === "admin" && allowed.has("mga_payables")
      ? createMgaPayablesApi(client).list("unpaid").catch(() => null)
      : Promise.resolve(null);
  const paySheetsPromise =
    user.role === "admin" && allowed.has("pay_sheets")
      ? createPaySheetsApi(client).list().catch(() => null)
      : Promise.resolve(null);

  const [approvalWork, myItems, myCommissions, mgaPayables, paySheets] =
    await Promise.all([
      approvalWorkPromise,
      myItemsPromise,
      myCommissionsPromise,
      mgaPayablesPromise,
      paySheetsPromise,
    ]);
  return navigationCountsFromProjectedData({
    approvalWork,
    mgaPayables,
    myCommissions,
    myItems,
    paySheets,
  });
}

export function navigationCountsFromProjectedData({
  approvalWork,
  mgaPayables,
  myCommissions,
  myItems,
  paySheets,
}: {
  approvalWork: ApprovalWorkListResponse | null;
  mgaPayables: MgaPayableListResponse | null;
  myCommissions: MyCommissionsResponse | null;
  myItems: MyItemsResponse | null;
  paySheets: PaySheetListResponse | null;
}): NavigationCounts {
  return {
    ...(approvalWork === null
      ? {}
      : {
          approvals: approvalWork.submissions.length,
          help_requests: approvalWork.helpRequests.length,
          policy_change_requests: approvalWork.changeRequests.length,
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
    ...(mgaPayables === null
      ? {}
      : { mga_payables: mgaPayables.summary.unpaidCount }),
    ...(paySheets === null
      ? {}
      : {
          pay_sheets: paySheets.items.filter(
            (sheet) => sheet.status === "open" && sheet.policyCount > 0,
          ).length,
        }),
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

export function reviewQueueNavigationCount(
  counts: NavigationCounts,
): number | null {
  const values = [
    counts.approvals,
    counts.help_requests,
    counts.policy_change_requests,
  ].filter(
    (value): value is number =>
      value !== undefined && Number.isSafeInteger(value) && value >= 0,
  );
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? total : null;
}
