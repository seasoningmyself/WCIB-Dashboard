import React from "react";
import {
  formatAbsoluteTimestamp,
  formatRelativeTime,
} from "../ui/time.js";
import type {
  AgencyOverviewSnapshot,
  AgencyOverviewState,
} from "./overview.js";
import {
  formatKpiCount,
  formatKpiMoney,
} from "./view-state.js";

export function AgencyOverviewModules({
  now,
  onRetry,
  state,
}: {
  now: Date;
  onRetry(): void;
  state: AgencyOverviewState;
}) {
  if (state.status === "denied") return null;
  if (state.status !== "ready") {
    return (
      <AgencyOverviewMessage
        kind={state.status}
        onRetry={onRetry}
      />
    );
  }
  return (
    <>
      <LiveAgencySummary overview={state.overview} />
      <RecentAgencyActivity activities={state.overview.activities} now={now} />
    </>
  );
}

function AgencyOverviewMessage({
  kind,
  onRetry,
}: {
  kind: "error" | "loading";
  onRetry(): void;
}) {
  return (
    <section
      aria-busy={kind === "loading"}
      className="kpi-module-message"
    >
      <h2>
        {kind === "loading"
          ? "Loading current agency activity"
          : "Current agency activity unavailable"}
      </h2>
      <p>
        {kind === "loading"
          ? "Retrieving the latest information..."
          : "This section could not be loaded. Settled agency results remain available."}
      </p>
      {kind === "error" ? (
        <button onClick={onRetry} type="button">Try again</button>
      ) : null}
    </section>
  );
}

function LiveAgencySummary({
  overview,
}: {
  overview: AgencyOverviewSnapshot;
}) {
  const month = monthYearLabel(overview.month);
  return (
    <section className="kpi-live-module" aria-labelledby="kpi-live-title">
      <header className="kpi-module-heading">
        <div>
          <p>Current period</p>
          <h2 id="kpi-live-title">{month} in progress</h2>
          <span>Live operational figures that can still change.</span>
        </div>
        <span className="kpi-period-state is-live">In progress</span>
      </header>
      <div className="kpi-live-grid">
        <a className="kpi-live-stat" href="#/policy-ledger">
          <span>Policies approved</span>
          <strong>{formatKpiCount(overview.policiesApproved)}</strong>
          <small>{month} ledger</small>
        </a>
        <a className="kpi-live-stat is-primary" href="#/policy-ledger">
          <span>Agency revenue</span>
          <strong>{formatKpiMoney(overview.agencyRevenue)}</strong>
          <small>Live, not yet settled</small>
        </a>
        <a className="kpi-live-stat" href="#/approvals">
          <span>Awaiting review</span>
          <strong>{formatKpiCount(overview.reviewItemCount)}</strong>
          <small>{reviewQueueBreakdown(overview)}</small>
        </a>
        <a className="kpi-live-stat" href="#/mga-payables">
          <span>MGA payables</span>
          <strong>{formatKpiMoney(overview.outstandingMgaAmount)}</strong>
          <small>{formatKpiCount(overview.outstandingMgaCount)} outstanding</small>
        </a>
      </div>
    </section>
  );
}

function RecentAgencyActivity({
  activities,
  now,
}: {
  activities: AgencyOverviewSnapshot["activities"];
  now: Date;
}) {
  return (
    <section
      className="kpi-recent-activity"
      aria-labelledby="kpi-recent-activity-title"
    >
      <header className="kpi-module-heading">
        <div>
          <p>Recent activity</p>
          <h2 id="kpi-recent-activity-title">Latest completed work</h2>
          <span>Up to eight recent approvals and pay-sheet closures.</span>
        </div>
      </header>
      {activities.length === 0 ? (
        <p className="kpi-recent-empty">
          Completed approvals and pay-sheet closures will appear here.
        </p>
      ) : (
        <ol className="kpi-recent-list">
          {activities.map((activity, index) => (
            <li
              key={`${activity.actionType}:${activity.targetReference}:${activity.occurredAt}:${index}`}
            >
              <span className={`kpi-activity-mark is-${activity.actionType}`} aria-hidden="true" />
              <div>
                <strong>{activityLabel(activity.actionType)}</strong>
                <span>
                  {activity.targetReference} · {activity.actorDisplayName}
                </span>
              </div>
              <time
                dateTime={activity.occurredAt}
                title={formatAbsoluteTimestamp(activity.occurredAt)}
              >
                {formatRelativeTime(activity.occurredAt, now)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function monthYearLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    !Number.isInteger(year) ||
    !Number.isInteger(month)
  ) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function activityLabel(
  action: AgencyOverviewSnapshot["activities"][number]["actionType"],
): string {
  return action === "policy_approved"
    ? "Policy approved"
    : "Pay sheet closed";
}

function reviewQueueBreakdown(overview: AgencyOverviewSnapshot): string {
  const parts: string[] = [];
  if (overview.submittedTurnInCount > 0) {
    parts.push(`${overview.submittedTurnInCount} submitted`);
  }
  if (overview.helpRequestCount > 0) {
    parts.push(`${overview.helpRequestCount} help requested`);
  }
  if (overview.policyChangeRequestCount > 0) {
    const suffix = overview.policyChangeRequestCount === 1 ? "" : "s";
    parts.push(`${overview.policyChangeRequestCount} policy change${suffix}`);
  }
  return parts.length === 0 ? "Nothing waiting" : parts.join(" · ");
}
