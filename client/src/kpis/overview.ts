import type { KpiRecentActivityItem } from "../../../shared/kpi-activity.js";
import type { ApiClient } from "../api/client.js";
import { createApprovalApi } from "../approvals/api.js";
import { createPolicyLedgerApi } from "../ledger/api.js";
import { currentLedgerMonth } from "../ledger/view-state.js";
import { createMgaPayablesApi } from "../mga-payables/api.js";
import { createKpiApi } from "./api.js";

export interface AgencyOverviewSnapshot {
  activities: readonly KpiRecentActivityItem[];
  agencyRevenue: string;
  helpRequestCount: number;
  month: string;
  outstandingMgaAmount: string;
  outstandingMgaCount: number;
  policyChangeRequestCount: number;
  policiesApproved: number;
  reviewItemCount: number;
  submittedTurnInCount: number;
}

export type AgencyOverviewState =
  | { status: "denied" | "error" | "loading" }
  | { overview: AgencyOverviewSnapshot; status: "ready" };

export class AgencyOverviewApiError extends Error {
  constructor(readonly kind: "denied" | "unavailable") {
    super("Agency overview request could not be completed");
    this.name = "AgencyOverviewApiError";
  }
}

export async function loadAgencyOverview(
  client: ApiClient,
  now = new Date(),
): Promise<AgencyOverviewSnapshot> {
  const month = currentLedgerMonth(now);
  const [ledger, approvalWork, payables, recentActivity] = await Promise.all(
    [
      createPolicyLedgerApi(client).list({ month }),
      createApprovalApi(client).list(),
      createMgaPayablesApi(client).list("unpaid"),
      createKpiApi(client).loadRecentActivity(),
    ],
  ).catch((error: unknown) => {
    throw new AgencyOverviewApiError(
      hasApiErrorKind(error, "denied") ? "denied" : "unavailable",
    );
  });
  const submittedTurnInCount = approvalWork.submissions.length;
  const helpRequestCount = approvalWork.helpRequests.length;
  const policyChangeRequestCount = approvalWork.changeRequests.length;
  return Object.freeze({
    activities: Object.freeze([...recentActivity.activities]),
    agencyRevenue: ledger.totals.agencyRevenue,
    helpRequestCount,
    month,
    outstandingMgaAmount: payables.summary.outstandingAmount,
    outstandingMgaCount: payables.summary.unpaidCount,
    policyChangeRequestCount,
    policiesApproved: ledger.filteredTotal,
    reviewItemCount:
      submittedTurnInCount +
      helpRequestCount +
      policyChangeRequestCount,
    submittedTurnInCount,
  });
}

function hasApiErrorKind(
  error: unknown,
  kind: string,
): boolean {
  return (
    error instanceof Error &&
    "kind" in error &&
    error.kind === kind
  );
}
