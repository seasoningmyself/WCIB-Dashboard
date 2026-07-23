import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  KpiActualPeriod,
  KpiActualResponse,
} from "../../../shared/kpi-actuals.js";
import type { KpiTargetListResponse } from "../../../shared/kpi-target-api.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { EmptyState } from "../ui/EmptyState.js";
import { PageHeader } from "../ui/PageHeader.js";
import { createKpiApi, KpiApiError } from "./api.js";
import {
  KPI_PERIOD_OPTIONS,
  buildKpiTargetInput,
  countTargetUnits,
  decodeKpiScope,
  emptyKpiTargetInput,
  encodeKpiScope,
  findKpiTarget,
  formatKpiCount,
  formatKpiMoney,
  formatKpiRate,
  isKpiAdmin,
  kpiTargetEditorValues,
  moneyToCents,
  rateToHundredths,
  targetProgress,
  trendBarPercent,
  type KpiScopeSelection,
  type KpiTargetEditorValues,
} from "./view-state.js";

export type KpiScreenState =
  | { status: "denied" | "error" | "loading" }
  | {
      actuals: KpiActualResponse;
      status: "ready";
      targets: KpiTargetListResponse;
    };

const COMPANY_SCOPE: KpiScopeSelection = Object.freeze({
  producerUserId: null,
  scopeType: "company",
});
const EMPTY_TARGETS: KpiTargetEditorValues = Object.freeze({
  newPolicyCountTarget: "",
  newRevenueTarget: "",
  retentionRateTarget: "",
});

export function KpisGoals({ user }: { user: CurrentUser }) {
  return isKpiAdmin(user) ? (
    <KpisGoalsController />
  ) : (
    <KpiMessage kind="denied" />
  );
}

function KpisGoalsController() {
  const client = useApiClient();
  const api = useMemo(() => createKpiApi(client), [client]);
  const [scope, setScope] = useState<KpiScopeSelection>(COMPANY_SCOPE);
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [yearDraft, setYearDraft] = useState(String(year));
  const [period, setPeriod] = useState<KpiActualPeriod>("full");
  const [state, setState] = useState<KpiScreenState>({ status: "loading" });
  const [targetValues, setTargetValues] =
    useState<KpiTargetEditorValues>(EMPTY_TARGETS);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const pendingRef = useRef(false);

  const load = useCallback(async (showLoading = true) => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    if (showLoading) setState({ status: "loading" });
    try {
      const query = scope.scopeType === "company"
        ? { period, scopeType: "company" as const, year }
        : {
            period,
            producerUserId: scope.producerUserId ?? "",
            scopeType: "producer" as const,
            year,
          };
      const [targets, actuals] = await Promise.all([
        api.loadTargets(year),
        api.loadActuals(query),
      ]);
      if (requestVersion.current !== version) return;
      setState({ actuals, status: "ready", targets });
      setTargetValues(kpiTargetEditorValues(findKpiTarget(targets, scope)));
    } catch (error) {
      if (requestVersion.current !== version) return;
      setState({
        status:
          error instanceof KpiApiError && error.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [api, period, scope, year]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  const clearSensitiveState = useCallback(() => {
    requestVersion.current += 1;
    pendingRef.current = false;
    setScope(COMPANY_SCOPE);
    setPeriod("full");
    setState({ status: "loading" });
    setTargetValues(EMPTY_TARGETS);
    setPending(false);
    setFormError(null);
    setNotice(null);
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const saveTarget = useCallback(async (clear: boolean) => {
    if (pendingRef.current) return;
    const result = clear
      ? { input: emptyKpiTargetInput(scope), success: true as const }
      : buildKpiTargetInput(targetValues, scope);
    if (!result.success) {
      setFormError(result.message);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setFormError(null);
    setNotice(null);
    try {
      await api.saveTarget(scope.scopeType, year, result.input);
      await load(false);
      setNotice(clear ? "Annual targets cleared." : "Annual targets saved.");
    } catch (error) {
      if (error instanceof KpiApiError && error.kind === "denied") {
        requestVersion.current += 1;
        setState({ status: "denied" });
      } else {
        setFormError(targetMutationMessage(error));
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [api, load, scope, targetValues, year]);

  const applyYear = useCallback((event: FormEvent) => {
    event.preventDefault();
    const next = Number(yearDraft);
    if (!Number.isInteger(next) || next < 2000 || next > 9999) {
      setFormError("Year must be between 2000 and 9999.");
      return;
    }
    setFormError(null);
    setNotice(null);
    setYear(next);
  }, [yearDraft]);

  return (
    <KpisGoalsView
      formError={formError}
      notice={notice}
      onApplyYear={applyYear}
      onClear={() => void saveTarget(true)}
      onPeriod={(next) => {
        setFormError(null);
        setNotice(null);
        setPeriod(next);
      }}
      onRetry={() => void load()}
      onSave={() => void saveTarget(false)}
      onScope={(value) => {
        const next = decodeKpiScope(value);
        if (next === null) return;
        setFormError(null);
        setNotice(null);
        setScope(next);
      }}
      onTargetValues={setTargetValues}
      onYearDraft={setYearDraft}
      pending={pending}
      period={period}
      scope={scope}
      state={state}
      targetValues={targetValues}
      year={year}
      yearDraft={yearDraft}
    />
  );
}

export function KpisGoalsView({
  formError,
  notice,
  onApplyYear,
  onClear,
  onPeriod,
  onRetry,
  onSave,
  onScope,
  onTargetValues,
  onYearDraft,
  pending,
  period,
  scope,
  state,
  targetValues,
  year,
  yearDraft,
}: {
  formError: string | null;
  notice: string | null;
  onApplyYear(event: FormEvent): void;
  onClear(): void;
  onPeriod(period: KpiActualPeriod): void;
  onRetry(): void;
  onSave(): void;
  onScope(value: string): void;
  onTargetValues(values: KpiTargetEditorValues): void;
  onYearDraft(value: string): void;
  pending: boolean;
  period: KpiActualPeriod;
  scope: KpiScopeSelection;
  state: KpiScreenState;
  targetValues: KpiTargetEditorValues;
  year: number;
  yearDraft: string;
}) {
  if (state.status !== "ready") {
    return <KpiMessage kind={state.status} onRetry={onRetry} />;
  }
  const scopeValue = encodeKpiScope(scope);
  const configuredTarget = findKpiTarget(state.targets, scope);
  const firstRun =
    state.actuals.empty &&
    (
      configuredTarget === null ||
      (
        configuredTarget.newPolicyCountTarget === null &&
        configuredTarget.newRevenueTarget === null &&
        configuredTarget.retentionRateTarget === null
      )
    );
  const scopeName = state.actuals.scope.scopeType === "company"
    ? "Company-wide"
    : state.actuals.scope.displayName ?? "Selected producer";
  return (
    <section className="kpi-page" aria-labelledby="kpi-page-title">
      <PageHeader
        eyebrow="Closed performance"
        status={(
          <>
            Showing <strong>{scopeName}</strong> for {year}, {period === "full" ? "full year" : period}.
          </>
        )}
        title="Agency Overview"
        titleId="kpi-page-title"
      />

      <section className="kpi-controls" aria-label="KPI scope and period">
        <label>
          <span>View</span>
          <select
            disabled={pending}
            onChange={(event) => onScope(event.currentTarget.value)}
            value={scopeValue}
          >
            <option value="company">Company-wide</option>
            {state.targets.producers.map((producer) => (
              <option
                key={producer.producerUserId}
                value={`producer:${producer.producerUserId}`}
              >
                {producer.displayName}{producer.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        <form className="kpi-year-control" onSubmit={onApplyYear}>
          <label htmlFor="kpi-year">
            <span>Year</span>
            <input
              disabled={pending}
              id="kpi-year"
              inputMode="numeric"
              max="9999"
              min="2000"
              onChange={(event) => onYearDraft(event.currentTarget.value)}
              type="number"
              value={yearDraft}
            />
          </label>
          <button disabled={pending || yearDraft === String(year)} type="submit">
            Apply
          </button>
        </form>
        <div className="kpi-period-control" role="group" aria-label="KPI period">
          {KPI_PERIOD_OPTIONS.map((option) => (
            <button
              aria-pressed={period === option.value}
              disabled={pending}
              key={option.value}
              onClick={() => onPeriod(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {notice === null ? null : <div className="kpi-notice" role="status">{notice}</div>}
      {formError === null ? null : <div className="kpi-form-error" role="alert">{formError}</div>}

      {firstRun ? (
        <AgencyOverviewZeroState
          actuals={state.actuals}
          key={`${scopeValue}:${year}`}
          onClear={onClear}
          onSave={onSave}
          onValues={onTargetValues}
          pending={pending}
          values={targetValues}
          year={year}
        />
      ) : (
        <TargetEditor
          actuals={state.actuals}
          onClear={onClear}
          onSave={onSave}
          onValues={onTargetValues}
          pending={pending}
          values={targetValues}
        />
      )}

      {firstRun ? null : state.actuals.empty ? (
          <EmptyState
            action={<a href="#/pay-sheets">View pay sheets</a>}
            body="KPI actuals appear after a pay sheet is closed for the selected period."
            className="kpi-empty"
            heading="No closed performance yet"
            headingId="kpi-empty-title"
          />
        ) : (
          <KpiActuals actuals={state.actuals} />
        )}
    </section>
  );
}

function AgencyOverviewZeroState({
  actuals,
  onClear,
  onSave,
  onValues,
  pending,
  values,
  year,
}: {
  actuals: KpiActualResponse;
  onClear(): void;
  onSave(): void;
  onValues(values: KpiTargetEditorValues): void;
  pending: boolean;
  values: KpiTargetEditorValues;
  year: number;
}) {
  const [editing, setEditing] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const startEditing = () => {
    setEditing(true);
    requestAnimationFrame(() => {
      sectionRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
  };
  return (
    <section
      className="app-empty-state kpi-empty kpi-first-run"
      ref={sectionRef}
    >
      <h2>Set annual targets for {year}</h2>
      <p>
        Add goals for new policies, new revenue, and retention. Once a pay sheet
        closes, this page will compare actual results with those targets.
      </p>
      {editing ? (
        <TargetEditor
          actuals={actuals}
          allowClear={false}
          onClear={onClear}
          onSave={onSave}
          onValues={onValues}
          pending={pending}
          values={values}
        />
      ) : (
        <div className="app-empty-state-action kpi-first-run-actions">
          <button disabled={pending} onClick={startEditing} type="button">
            Set annual targets
          </button>
          <a href="#/pay-sheets">View pay sheets</a>
        </div>
      )}
    </section>
  );
}

function TargetEditor({
  actuals,
  allowClear = true,
  onClear,
  onSave,
  onValues,
  pending,
  values,
}: {
  actuals: KpiActualResponse;
  allowClear?: boolean;
  onClear(): void;
  onSave(): void;
  onValues(values: KpiTargetEditorValues): void;
  pending: boolean;
  values: KpiTargetEditorValues;
}) {
  return (
    <form
      className="kpi-targets"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <header>
        <div>
          <p>Annual goals</p>
          <h2>Targets vs. actuals</h2>
        </div>
        <div className="kpi-target-actions">
          {allowClear ? (
            <button className="is-clear" disabled={pending} onClick={onClear} type="button">
              Clear targets
            </button>
          ) : null}
          <button className="is-primary" disabled={pending} type="submit">
            {pending ? "Saving..." : "Save targets"}
          </button>
        </div>
      </header>
      <div className="kpi-target-grid">
        <TargetField
          actual={BigInt(actuals.totals.newPolicyCount)}
          actualLabel={formatKpiCount(actuals.totals.newPolicyCount)}
          inputLabel="New policies goal"
          inputMode="numeric"
          onValue={(value) => onValues({ ...values, newPolicyCountTarget: value })}
          target={countTargetUnits(values.newPolicyCountTarget)}
          value={values.newPolicyCountTarget}
        />
        <TargetField
          actual={moneyToCents(actuals.totals.newRevenue)}
          actualLabel={formatKpiMoney(actuals.totals.newRevenue)}
          inputLabel="New revenue goal"
          inputMode="decimal"
          onValue={(value) => onValues({ ...values, newRevenueTarget: value })}
          prefix="$"
          target={values.newRevenueTarget === "" ? null : moneyToCents(values.newRevenueTarget)}
          value={values.newRevenueTarget}
        />
        <TargetField
          actual={rateToHundredths(actuals.totals.retentionRate)}
          actualLabel={formatKpiRate(actuals.totals.retentionRate)}
          inputLabel="Retention goal"
          inputMode="decimal"
          onValue={(value) => onValues({ ...values, retentionRateTarget: value })}
          suffix="%"
          target={values.retentionRateTarget === "" ? null : rateToHundredths(values.retentionRateTarget)}
          value={values.retentionRateTarget}
        />
      </div>
    </form>
  );
}

function TargetField({
  actual,
  actualLabel,
  inputLabel,
  inputMode,
  onValue,
  prefix,
  suffix,
  target,
  value,
}: {
  actual: bigint;
  actualLabel: string;
  inputLabel: string;
  inputMode: "decimal" | "numeric";
  onValue(value: string): void;
  prefix?: string;
  suffix?: string;
  target: bigint | null;
  value: string;
}) {
  const progress = targetProgress(actual, target);
  return (
    <label className="kpi-target-field">
      <span>{inputLabel}</span>
      <strong>{actualLabel}</strong>
      <small>Actual from closed sheets</small>
      <span className="kpi-target-input">
        {prefix === undefined ? null : <span>{prefix}</span>}
        <input
          aria-label={inputLabel}
          inputMode={inputMode}
          min="0"
          onChange={(event) => onValue(event.currentTarget.value)}
          placeholder="Not set"
          step={inputMode === "numeric" ? "1" : "0.01"}
          type="number"
          value={value}
        />
        {suffix === undefined ? null : <span>{suffix}</span>}
      </span>
      {progress === null ? (
        <span className="kpi-progress-empty">No annual target</span>
      ) : (
        <span className="kpi-progress">
          <span aria-hidden="true"><i style={{ width: `${progress.percent}%` }} /></span>
          <small className={progress.met ? "is-met" : ""}>{progress.label}</small>
        </span>
      )}
    </label>
  );
}

function KpiActuals({ actuals }: { actuals: KpiActualResponse }) {
  const { totals } = actuals;
  return (
    <div className="kpi-actuals">
      <section className="kpi-section" aria-labelledby="kpi-activity-title">
        <SectionHeading eyebrow="Closed activity" id="kpi-activity-title" title="Business performance" />
        <div className="kpi-stat-grid">
          <StatCard
            accent="green"
            label="New business"
            sub={`${formatKpiMoney(totals.newRevenue)} revenue`}
            value={`${formatKpiCount(totals.newPolicyCount)} policies`}
          />
          <StatCard
            accent="violet"
            label="Renewal / existing"
            sub="Closed activity"
            value={`${formatKpiCount(totals.existingPolicyCount)} policies`}
          />
          <StatCard
            accent="teal"
            label="Retention rate"
            sub="Existing divided by all policies"
            value={formatKpiRate(totals.retentionRate)}
          />
          <StatCard
            accent="blue"
            label="Agency revenue"
            sub={`${formatKpiCount(totals.policyCount)} policies`}
            value={formatKpiMoney(totals.agencyRevenue)}
          />
          <StatCard
            accent="amber"
            label="Won-back clients"
            sub={`${formatKpiMoney(totals.wonBackRevenue)} revenue`}
            value={`${formatKpiCount(totals.wonBackCount)} policies`}
          />
        </div>
      </section>

      <section className="kpi-section" aria-labelledby="kpi-payout-title">
        <SectionHeading eyebrow="Producer compensation" id="kpi-payout-title" title="Payout lens" />
        <div
          className={`kpi-zero-target ${moneyToCents(totals.producerFirstYearHousePayout) > 0n ? "is-over" : "is-met"}`}
        >
          <div>
            <span>First-year house paid / target $0</span>
            <strong>{formatKpiMoney(totals.producerFirstYearHousePayout)}</strong>
          </div>
          <small>
            {moneyToCents(totals.producerFirstYearHousePayout) > 0n
              ? "Above target"
              : "At target"}
          </small>
        </div>
        <div className="kpi-stat-grid is-three">
          <StatCard accent="teal" label="Total paid" value={formatKpiMoney(totals.producerPayout)} />
          <StatCard accent="blue" label="Producer book" value={formatKpiMoney(totals.producerBookPayout)} />
          <StatCard accent="amber" label="First-year house" value={formatKpiMoney(totals.producerFirstYearHousePayout)} />
        </div>
      </section>

      <MonthlyTrend actuals={actuals} />

      <div className="kpi-breakdown-grid">
        <BreakdownSection
          id="kpi-transaction-types"
          items={actuals.transactionTypes.map((item) => ({
            key: item.transactionType,
            label: item.transactionType,
            meta: `${formatKpiCount(item.policyCount)} policies`,
            value: formatKpiMoney(item.agencyRevenue),
          }))}
          title="Transaction types"
        />
        <BreakdownSection
          id="kpi-offices"
          items={actuals.offices.map((item) => ({
            key: item.officeLocationId,
            label: item.displayName,
            meta: `${formatKpiCount(item.policyCount)} policies / ${formatKpiCount(item.newPolicyCount)} new`,
            value: formatKpiMoney(item.agencyRevenue),
          }))}
          title="Revenue by office"
        />
      </div>

      {actuals.producerPayouts.length === 0 ? null : (
        <BreakdownSection
          id="kpi-producer-payouts"
          items={actuals.producerPayouts.map((item) => ({
            key: item.producerUserId,
            label: item.displayName,
            meta: `${formatKpiMoney(item.bookPayout)} book / ${formatKpiMoney(item.firstYearHousePayout)} first-year`,
            value: formatKpiMoney(item.totalPayout),
          }))}
          title="Producer payout breakdown"
          wide
        />
      )}
    </div>
  );
}

function MonthlyTrend({ actuals }: { actuals: KpiActualResponse }) {
  const company = actuals.scope.scopeType === "company";
  const values = actuals.monthly.map((item) =>
    company ? item.agencyRevenue : item.producerPayout
  );
  return (
    <section className="kpi-section" aria-labelledby="kpi-trend-title">
      <SectionHeading
        eyebrow={`${actuals.year} trend`}
        id="kpi-trend-title"
        title={company ? "Agency revenue by month" : "Producer payout by month"}
      />
      <div className="kpi-trend" role="img" aria-label="Monthly closed KPI values">
        {actuals.monthly.map((item, index) => {
          const value = values[index] ?? "0.00";
          return (
            <div className="kpi-trend-column" key={item.month}>
              <span className="kpi-trend-value">{formatKpiMoney(value)}</span>
              <span className="kpi-trend-track" aria-hidden="true">
                <i style={{ height: `${trendBarPercent(value, values)}%` }} />
              </span>
              <strong>{monthLabel(item.month)}</strong>
              <small>{formatKpiCount(item.policyCount)} policies</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatCard({
  accent,
  label,
  sub,
  value,
}: {
  accent: "amber" | "blue" | "green" | "teal" | "violet";
  label: string;
  sub?: string;
  value: string;
}) {
  return (
    <article className={`kpi-stat is-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub === undefined ? null : <small>{sub}</small>}
    </article>
  );
}

function SectionHeading({ eyebrow, id, title }: { eyebrow: string; id: string; title: string }) {
  return (
    <header className="kpi-section-heading">
      <p>{eyebrow}</p>
      <h2 id={id}>{title}</h2>
    </header>
  );
}

function BreakdownSection({
  id,
  items,
  title,
  wide = false,
}: {
  id: string;
  items: readonly { key: string; label: string; meta: string; value: string }[];
  title: string;
  wide?: boolean;
}) {
  return (
    <section className={`kpi-breakdown ${wide ? "is-wide" : ""}`} aria-labelledby={id}>
      <header>
        <h2 id={id}>{title}</h2>
        <span>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="kpi-breakdown-empty">No closed activity in this period.</p>
      ) : (
        <div className="kpi-breakdown-list">
          {items.map((item) => (
            <div className="kpi-breakdown-row" key={item.key}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.meta}</span>
              </div>
              <b>{item.value}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function KpiMessage({
  kind,
  onRetry,
}: {
  kind: "denied" | "error" | "loading";
  onRetry?: () => void;
}) {
  const content = kind === "loading"
    ? { body: "Retrieving closed performance and annual targets...", title: "Loading KPIs" }
    : kind === "denied"
      ? { body: "This page is not available for your account.", title: "KPIs unavailable" }
      : { body: "KPI data could not be loaded.", title: "KPIs unavailable" };
  return (
    <section className="kpi-message" aria-busy={kind === "loading"} aria-labelledby="kpi-message-title">
      <p>Performance</p>
      <h1 id="kpi-message-title">{content.title}</h1>
      <span>{content.body}</span>
      {kind !== "error" || onRetry === undefined ? null : (
        <button onClick={onRetry} type="button">Try again</button>
      )}
    </section>
  );
}

function targetMutationMessage(error: unknown): string {
  if (!(error instanceof KpiApiError)) return "Targets could not be saved.";
  switch (error.kind) {
    case "conflict":
      return "The selected producer or target changed. Refresh and try again.";
    case "invalid_response":
      return "The saved target response was invalid. Refresh before trying again.";
    case "rejected":
      return "Review each target value and try again.";
    case "unavailable":
      return "Targets could not be saved. Check your connection and try again.";
    case "denied":
      return "This page is not available for your account.";
  }
}

function monthLabel(month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, month - 1, 1)));
}
