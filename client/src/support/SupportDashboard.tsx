import React, { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  KPI_ACTUAL_PERIODS,
  type KpiActualPeriod,
} from "../../../shared/kpi-actuals.js";
import type { OperationalSupportDashboard } from "../../../shared/support-dashboard.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { OfficeLocationsSettings } from "../offices/OfficeLocationsSettings.js";
import { PageHeader } from "../ui/PageHeader.js";
import { createSupportApi, SupportApiError, type SupportApi } from "./api.js";
import { SupportMfaRecovery } from "./SupportMfaRecovery.js";

type SupportState =
  | { status: "denied" | "error" | "loading" }
  | { dashboard: OperationalSupportDashboard; status: "ready" };

export function SupportDashboard({ user }: { user: CurrentUser }) {
  const client = useApiClient();
  const api = useMemo(() => createSupportApi(client), [client]);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [yearDraft, setYearDraft] = useState(String(currentYear));
  const [period, setPeriod] = useState<KpiActualPeriod>("full");
  const [state, setState] = useState<SupportState>({ status: "loading" });

  const clear = useCallback(() => {
    setState({ status: "loading" });
  }, []);
  useSensitiveSessionCleanup(clear);

  const load = useCallback(async () => {
    if (!user.capabilities.includes("support_engineer")) {
      setState({ status: "denied" });
      return;
    }
    setState({ status: "loading" });
    try {
      setState({ dashboard: await api.loadDashboard({ period, year }), status: "ready" });
    } catch (error) {
      setState({
        status:
          error instanceof SupportApiError && error.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [api, period, user.capabilities, year]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status !== "ready") {
    return <SupportMessage kind={state.status} onRetry={() => void load()} />;
  }

  return (
    <SupportDashboardView
      api={api}
      dashboard={state.dashboard}
      onApplyYear={(event) => {
        event.preventDefault();
        const next = Number(yearDraft);
        if (Number.isInteger(next) && next >= 2000 && next <= 9999) setYear(next);
      }}
      onPeriod={setPeriod}
      onRefresh={() => void load()}
      onYearDraft={setYearDraft}
      period={period}
      user={user}
      year={year}
      yearDraft={yearDraft}
    />
  );
}

export function SupportDashboardView({
  api,
  dashboard,
  onApplyYear,
  onPeriod,
  onRefresh,
  onYearDraft,
  period,
  user,
  year,
  yearDraft,
}: {
  api: SupportApi;
  dashboard: OperationalSupportDashboard;
  onApplyYear(event: FormEvent<HTMLFormElement>): void;
  onPeriod(period: KpiActualPeriod): void;
  onRefresh(): void;
  onYearDraft(value: string): void;
  period: KpiActualPeriod;
  user: CurrentUser;
  year: number;
  yearDraft: string;
}) {
  return (
    <section className="support-page" aria-labelledby="support-page-title">
      <PageHeader
        actions={<button onClick={onRefresh} type="button">Refresh status</button>}
        eyebrow="Engineering support"
        status={<>Operational status and aggregate company facts as of <strong>{formatTimestamp(dashboard.observedAt)}</strong>.</>}
        title="Support"
        titleId="support-page-title"
      />

      <section className="support-controls" aria-label="Aggregate company period">
        <form onSubmit={onApplyYear}>
          <label htmlFor="support-year">
            <span>Year</span>
            <input
              id="support-year"
              max="9999"
              min="2000"
              onChange={(event) => onYearDraft(event.currentTarget.value)}
              type="number"
              value={yearDraft}
            />
          </label>
          <button disabled={yearDraft === String(year)} type="submit">Apply</button>
        </form>
        <label>
          <span>Period</span>
          <select onChange={(event) => onPeriod(event.currentTarget.value as KpiActualPeriod)} value={period}>
            {KPI_ACTUAL_PERIODS.map((value) => (
              <option key={value} value={value}>{value === "full" ? "Full year" : value}</option>
            ))}
          </select>
        </label>
      </section>

      <OperationalSummary dashboard={dashboard} />
      <CompanyNumbers dashboard={dashboard} />
      <SystemDiagnostics dashboard={dashboard} />
      <SupportMfaRecovery api={api} user={user} />
      <OfficeLocationsSettings embedded user={user} />
    </section>
  );
}

function OperationalSummary({ dashboard }: { dashboard: OperationalSupportDashboard }) {
  const uptime = dashboard.uptime.percentage === null
    ? "Unavailable"
    : `${dashboard.uptime.percentage.toFixed(2)}%`;
  return (
    <section className="support-section" aria-labelledby="support-status-title">
      <SupportSectionHeading eyebrow="Live status" id="support-status-title" title="Release and availability" />
      <div className="support-stat-grid">
        <SupportStat label="Deployment" meta={dashboard.environment} value={dashboard.release.sha === null ? "Unavailable" : shortSha(dashboard.release.sha)} />
        <SupportStat label="Health" meta={formatTimestamp(dashboard.health.checkedAt)} state="good" value="Healthy" />
        <SupportStat
          label="Readiness"
          meta={dashboard.readiness.databaseReachable ? "Database reachable" : "Database unavailable"}
          state={dashboard.readiness.status === "ready" ? "good" : "warning"}
          value={sentenceCase(dashboard.readiness.status)}
        />
        <SupportStat label="30-day uptime" meta={`${dashboard.uptime.failedCheckCount} failed checks`} value={uptime} />
      </div>
    </section>
  );
}

function CompanyNumbers({ dashboard }: { dashboard: OperationalSupportDashboard }) {
  const numbers = dashboard.companyNumbers;
  return (
    <section className="support-section" aria-labelledby="support-company-title">
      <SupportSectionHeading
        eyebrow={`${numbers.year} ${numbers.period === "full" ? "full year" : numbers.period}`}
        id="support-company-title"
        title="Aggregate company numbers"
      />
      <p className="support-section-copy">Closed pay sheets only. No producer, policy, insured, office, carrier, or MGA detail is included.</p>
      <div className="support-stat-grid is-five">
        <SupportStat label="Agency revenue" value={formatMoney(numbers.totals.agencyRevenue)} />
        <SupportStat label="Policies" value={formatCount(numbers.totals.policyCount)} />
        <SupportStat label="New policies" meta={`${formatMoney(numbers.totals.newRevenue)} revenue`} value={formatCount(numbers.totals.newPolicyCount)} />
        <SupportStat label="Retention" value={formatRate(numbers.totals.retentionRate)} />
        <SupportStat label="Won back" meta={`${formatMoney(numbers.totals.wonBackRevenue)} revenue`} value={formatCount(numbers.totals.wonBackCount)} />
      </div>
      <dl className="support-targets">
        <div><dt>New policy target</dt><dd>{nullableCount(numbers.targets.newPolicyCount)}</dd></div>
        <div><dt>New revenue target</dt><dd>{nullableMoney(numbers.targets.newRevenue)}</dd></div>
        <div><dt>Retention target</dt><dd>{formatRate(numbers.targets.retentionRate)}</dd></div>
        <div><dt>Last closed activity</dt><dd>{formatTimestamp(numbers.asOf)}</dd></div>
      </dl>
      <div className="support-table-wrap">
        <table className="support-table">
          <caption>Monthly aggregate company performance</caption>
          <thead><tr><th scope="col">Month</th><th scope="col">Revenue</th><th scope="col">Policies</th><th scope="col">New</th></tr></thead>
          <tbody>
            {numbers.monthly.map((month) => (
              <tr key={month.month}>
                <th scope="row">{monthLabel(month.month)}</th>
                <td>{formatMoney(month.agencyRevenue)}</td>
                <td>{formatCount(month.policyCount)}</td>
                <td>{formatCount(month.newPolicyCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SystemDiagnostics({ dashboard }: { dashboard: OperationalSupportDashboard }) {
  return (
    <div className="support-diagnostics-grid">
      <section className="support-section" aria-labelledby="support-schema-title">
        <SupportSectionHeading eyebrow="Schema contract" id="support-schema-title" title="Migration parity" />
        <dl className="support-detail-list">
          <Detail label="Status" value={sentenceCase(dashboard.migration.status)} />
          <Detail label="Local expected count" value={String(dashboard.migration.localExpectedCount)} />
          <Detail label="Managed expected count" value={nullableNumber(dashboard.migration.managedExpectedCount)} />
          <Detail code label="Local fingerprint" value={dashboard.migration.localFingerprint} />
          <Detail code label="Managed fingerprint" value={dashboard.migration.managedFingerprint ?? "Unavailable"} />
        </dl>
      </section>

      <section className="support-section" aria-labelledby="support-backup-title">
        <SupportSectionHeading eyebrow="Managed Postgres" id="support-backup-title" title="Backup freshness" />
        <dl className="support-detail-list">
          <Detail label="Status" value={sentenceCase(dashboard.backup.status)} />
          <Detail label="Latest recovery point" value={formatTimestamp(dashboard.backup.latestRecoveryPointAt)} />
          <Detail label="Recovery-point age" value={formatAge(dashboard.backup.ageSeconds)} />
          <Detail label="PITR" value={formatBoolean(dashboard.backup.pointInTimeRecoveryEnabled)} />
        </dl>
      </section>

      <section className="support-section" aria-labelledby="support-integrity-title">
        <SupportSectionHeading eyebrow="Application checks" id="support-integrity-title" title="Data integrity" />
        {dashboard.integrity.warnings.length === 0 ? (
          <p className="support-ok">No integrity warnings detected.</p>
        ) : (
          <ul className="support-warning-list">
            {dashboard.integrity.warnings.map((warning) => (
              <li key={warning.code}><strong>{warning.title}</strong><span>{warning.affectedCount} affected</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="support-section" aria-labelledby="support-login-title">
        <SupportSectionHeading eyebrow="Last 24 hours" id="support-login-title" title="Login security" />
        <dl className="support-detail-list">
          <Detail label="Account failure buckets" value={String(dashboard.loginSecurity.accountFailureBucketCount)} />
          <Detail label="IP failure buckets" value={String(dashboard.loginSecurity.ipFailureBucketCount)} />
          <Detail label="Active account cooldowns" value={String(dashboard.loginSecurity.activeAccountThrottleCount)} />
          <Detail label="Active IP cooldowns" value={String(dashboard.loginSecurity.activeIpThrottleCount)} />
          <Detail label="Last failure" value={formatTimestamp(dashboard.loginSecurity.lastFailureAt)} />
        </dl>
      </section>

      <section className="support-section" aria-labelledby="support-admin-title">
        <SupportSectionHeading eyebrow="Recovery coverage" id="support-admin-title" title="Administrators" />
        <div className="support-compact-list">
          {dashboard.administrators.map((administrator) => (
            <article key={administrator.email}>
              <div><strong>{administrator.displayName}</strong><span>{administrator.email}</span></div>
              <span>{administrator.mfaEnrolled ? "MFA enrolled" : "MFA not enrolled"}</span>
              <small>Last login {formatTimestamp(administrator.lastLoginAt)}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="support-section" aria-labelledby="support-audit-title">
        <SupportSectionHeading eyebrow="Aggregate only" id="support-audit-title" title="Audit activity" />
        <p className="support-section-copy">Event counts, categories, and timestamps only. Audit rows and business values are not exposed.</p>
        <div className="support-compact-list">
          {dashboard.auditActivity.categories.map((category) => (
            <article key={category.type}>
              <strong>{sentenceCase(category.type)}</strong>
              <span>{formatCount(category.count)} events</span>
              <small>Last {formatTimestamp(category.lastOccurredAt)}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="support-section is-wide" aria-labelledby="support-sentry-title">
        <SupportSectionHeading eyebrow="Error monitoring" id="support-sentry-title" title="Recent Sentry issues" />
        {dashboard.sentry.issues.length === 0 ? (
          <p>{dashboard.sentry.configured ? "No recent Sentry issues." : "Sentry is not configured for this environment."}</p>
        ) : (
          <div className="support-issue-list">
            {dashboard.sentry.issues.map((issue) => (
              <a href={issue.permalink} key={issue.shortId} rel="noreferrer" target="_blank">
                <strong>{issue.title}</strong>
                <span>{issue.shortId} / {issue.project} / {issue.eventCount} events</span>
                <small>Last seen {formatTimestamp(issue.lastSeen)}</small>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SupportSectionHeading({ eyebrow, id, title }: { eyebrow: string; id: string; title: string }) {
  return <header className="support-section-heading"><div><p>{eyebrow}</p><h2 id={id}>{title}</h2></div></header>;
}

function SupportStat({ label, meta, state, value }: { label: string; meta?: string; state?: "good" | "warning"; value: string }) {
  return <article className={`support-stat${state === undefined ? "" : ` is-${state}`}`}><span>{label}</span><strong>{value}</strong>{meta === undefined ? null : <small>{meta}</small>}</article>;
}

function Detail({ code = false, label, value }: { code?: boolean; label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{code ? <code>{value}</code> : value}</dd></div>;
}

function SupportMessage({ kind, onRetry }: { kind: "denied" | "error" | "loading"; onRetry(): void }) {
  const loading = kind === "loading";
  return (
    <section className="workspace-message" aria-busy={loading} aria-labelledby="support-message-title">
      <h1 id="support-message-title">{loading ? "Loading support status" : "Support unavailable"}</h1>
      <p>{loading ? "Checking the application and aggregate company facts..." : kind === "denied" ? "This page requires the support engineer capability." : "Support status could not be loaded."}</p>
      {kind === "error" ? <button onClick={onRetry} type="button">Try again</button> : null}
    </section>
  );
}

function shortSha(value: string): string {
  return value.slice(0, 12);
}

function sentenceCase(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function formatTimestamp(value: string | null): string {
  if (value === null) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(value: string): string {
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    style: "currency",
  }).format(Number(value));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function nullableCount(value: number | null): string {
  return value === null ? "Not set" : formatCount(value);
}

function nullableMoney(value: string | null): string {
  return value === null ? "Not set" : formatMoney(value);
}

function formatRate(value: string | null): string {
  return value === null ? "Not available" : `${Number(value).toFixed(2)}%`;
}

function nullableNumber(value: number | null): string {
  return value === null ? "Unavailable" : String(value);
}

function formatBoolean(value: boolean | null): string {
  return value === null ? "Unavailable" : value ? "Enabled" : "Disabled";
}

function formatAge(value: number | null): string {
  if (value === null) return "Unavailable";
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function monthLabel(month: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, month - 1, 1)),
  );
}
