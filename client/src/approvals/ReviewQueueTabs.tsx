import React from "react";

export function ReviewQueueTabs({
  active,
  approvalCount,
  helpRequestCount,
}: {
  active: "approvals" | "help_requests";
  approvalCount?: number;
  helpRequestCount?: number;
}) {
  return (
    <nav aria-label="Review queue sections" className="review-queue-tabs">
      <ReviewQueueTab
        active={active === "approvals"}
        count={approvalCount}
        href="#/approvals"
        label="Approvals"
      />
      <ReviewQueueTab
        active={active === "help_requests"}
        count={helpRequestCount}
        href="#/help-requests"
        label="Help Requests"
      />
    </nav>
  );
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
