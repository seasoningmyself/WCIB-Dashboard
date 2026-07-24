import React from "react";

export type ReviewQueueTabId =
  | "submitted_turn_ins"
  | "help_requests"
  | "policy_changes";

export function ReviewQueueTabs({
  active,
  helpRequestCount,
  policyChangeCount,
  showHelpRequests,
  showSubmittedTurnIns,
  submittedTurnInCount,
}: {
  active: ReviewQueueTabId;
  helpRequestCount?: number;
  policyChangeCount?: number;
  showHelpRequests: boolean;
  showSubmittedTurnIns: boolean;
  submittedTurnInCount?: number;
}) {
  return (
    <nav aria-label="Review queue sections" className="review-queue-tabs">
      {showSubmittedTurnIns ? (
        <ReviewQueueTab
          active={active === "submitted_turn_ins"}
          count={submittedTurnInCount}
          href="#/approvals"
          label="Submitted turn-ins"
        />
      ) : null}
      {showHelpRequests ? (
        <ReviewQueueTab
          active={active === "help_requests"}
          count={helpRequestCount}
          href="#/help-requests"
          label="Help requests"
        />
      ) : null}
      {showSubmittedTurnIns ? (
        <ReviewQueueTab
          active={active === "policy_changes"}
          count={policyChangeCount}
          href="#/approvals?view=policy-changes"
          label="Policy changes"
        />
      ) : null}
    </nav>
  );
}

export function reviewQueueTabFromPath(
  currentPath: string,
  routeId: "approvals" | "help_requests",
): ReviewQueueTabId {
  if (routeId === "help_requests") {
    return "help_requests";
  }
  const query = currentPath.split("?", 2)[1]?.split("#", 1)[0] ?? "";
  return new URLSearchParams(query).get("view") === "policy-changes"
    ? "policy_changes"
    : "submitted_turn_ins";
}

function ReviewQueueTab({
  active,
  count,
  href,
  label,
}: {
  active: boolean;
  count?: number;
  href: string;
  label: string;
}) {
  return (
    <a aria-current={active ? "page" : undefined} href={href}>
      <span>{label}</span>
      {isNavigationCount(count) ? <small>{count}</small> : null}
    </a>
  );
}

function isNavigationCount(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}
