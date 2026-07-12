import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftAssignmentOption } from "../../../shared/draft-assignment-options.js";
import {
  POLICY_LEDGER_FINANCE_FILTERS,
  POLICY_LEDGER_SORTS,
  type PolicyLedgerDetailResponse,
  type PolicyLedgerItem,
  type PolicyLedgerListQuery,
  type PolicyLedgerListResponse,
} from "../../../shared/policy-ledger.js";
import type { PolicyLedgerCorrectionRequest } from "../../../shared/policy-corrections.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import {
  PolicyCorrectionDialog,
  type LedgerCorrectionDialog,
} from "./CorrectionDialogs.js";
import { PolicyLedgerApiError, createPolicyLedgerApi } from "./api.js";
import {
  LEDGER_DETAIL_GROUPS,
  currentLedgerMonth,
  formatMoneyExact,
  isPolicyLedgerAdmin,
  ledgerAccountLabel,
  ledgerBadges,
  ledgerDetailValue,
} from "./view-state.js";

export type PolicyLedgerState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { data: PolicyLedgerListResponse; status: "ready" };

export type PolicyLedgerDetailState =
  | { status: "closed" }
  | { status: "error" }
  | { status: "loading" }
  | { data: PolicyLedgerDetailResponse; status: "ready" };

const INITIAL_LIMIT = 100;

export function PolicyLedger({ user }: { user: CurrentUser }) {
  return isPolicyLedgerAdmin(user) ? (
    <AdminPolicyLedger />
  ) : (
    <LedgerMessage
      body="This page is not available for your account."
      title="Policy ledger unavailable"
    />
  );
}

function AdminPolicyLedger() {
  const client = useApiClient();
  const api = useMemo(() => createPolicyLedgerApi(client), [client]);
  const [query, setQuery] = useState<PolicyLedgerListQuery>(() => ({
    direction: "desc",
    duplicates: "all",
    finance: "all",
    limit: INITIAL_LIMIT,
    month: currentLedgerMonth(),
    offset: 0,
    search: "",
    sort: "date",
  }));
  const [searchInput, setSearchInput] = useState("");
  const [state, setState] = useState<PolicyLedgerState>({ status: "loading" });
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PolicyLedgerDetailState>({ status: "closed" });
  const [assignmentOptions, setAssignmentOptions] = useState<readonly DraftAssignmentOption[]>([]);
  const [dialog, setDialog] = useState<LedgerCorrectionDialog | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const pendingRef = useRef(false);

  const load = useCallback(async () => {
    const version = listVersion.current + 1;
    listVersion.current = version;
    setState({ status: "loading" });
    try {
      const data = await api.list(query);
      if (listVersion.current === version) {
        setState({ data, status: "ready" });
      }
    } catch (error) {
      if (listVersion.current !== version) return;
      setState({
        status:
          error instanceof PolicyLedgerApiError && error.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [api, query]);

  const loadDetail = useCallback(
    async (policyId: string) => {
      const version = detailVersion.current + 1;
      detailVersion.current = version;
      setDetail({ status: "loading" });
      try {
        const data = await api.get(policyId);
        if (
          detailVersion.current === version &&
          expandedPolicyId === policyId
        ) {
          setDetail({ data, status: "ready" });
        }
      } catch (error) {
        if (detailVersion.current !== version) return;
        if (error instanceof PolicyLedgerApiError && error.kind === "denied") {
          listVersion.current += 1;
          setState({ status: "denied" });
          setExpandedPolicyId(null);
          setDetail({ status: "closed" });
        } else {
          setDetail({ status: "error" });
        }
      }
    },
    [api, expandedPolicyId],
  );

  useEffect(() => {
    void load();
    return () => {
      listVersion.current += 1;
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    void api
      .listAssignmentOptions()
      .then(({ producers }) => {
        if (active) setAssignmentOptions(producers);
      })
      .catch(() => {
        if (active) setAssignmentOptions([]);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const clearSensitiveState = useCallback(() => {
    listVersion.current += 1;
    detailVersion.current += 1;
    setState({ status: "loading" });
    setExpandedPolicyId(null);
    setDetail({ status: "closed" });
    setAssignmentOptions([]);
    setDialog(null);
    setNotice(null);
    pendingRef.current = false;
    setPending(false);
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const toggleDetail = useCallback(
    (policyId: string) => {
      if (expandedPolicyId === policyId) {
        detailVersion.current += 1;
        setExpandedPolicyId(null);
        setDetail({ status: "closed" });
        return;
      }
      setExpandedPolicyId(policyId);
      setDetail({ status: "loading" });
    },
    [expandedPolicyId],
  );

  useEffect(() => {
    if (expandedPolicyId !== null && detail.status === "loading") {
      void loadDetail(expandedPolicyId);
    }
  }, [detail.status, expandedPolicyId, loadDetail]);

  const submitCorrection = useCallback(
    async (input: PolicyLedgerCorrectionRequest) => {
      if (dialog === null || pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      const policyId = dialog.item.policy.id;
      try {
        const kind = await api.correct(policyId, input);
        setDialog(null);
        setNotice(
          kind === "override"
            ? "Financial override saved."
            : "Policy correction saved.",
        );
        await load();
        if (expandedPolicyId === policyId) {
          setDetail({ status: "loading" });
        }
      } catch (error) {
        setDialog(null);
        if (error instanceof PolicyLedgerApiError && error.kind === "denied") {
          listVersion.current += 1;
          setState({ status: "denied" });
          setExpandedPolicyId(null);
          setDetail({ status: "closed" });
          setNotice(null);
        } else if (
          error instanceof PolicyLedgerApiError && error.kind === "conflict"
        ) {
          setNotice("This policy changed while it was open. The ledger has been refreshed.");
          await load();
          if (expandedPolicyId === policyId) setDetail({ status: "loading" });
        } else if (
          error instanceof PolicyLedgerApiError && error.kind === "rejected"
        ) {
          setNotice("The correction was rejected. Review the values and reason.");
        } else {
          setNotice("The correction could not be saved. Try again.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [api, dialog, expandedPolicyId, load],
  );

  const updateQuery = useCallback(
    (update: Partial<PolicyLedgerListQuery>) => {
      setExpandedPolicyId(null);
      setDetail({ status: "closed" });
      setDialog(null);
      setNotice(null);
      setQuery((current) => ({ ...current, ...update, offset: 0 }));
    },
    [],
  );

  return (
    <>
      <PolicyLedgerView
        detail={detail}
        expandedPolicyId={expandedPolicyId}
        notice={notice}
        onCorrect={(item, kind) => setDialog({ item, kind })}
        onPage={(offset) => setQuery((current) => ({ ...current, offset }))}
        onQuery={updateQuery}
        onRetry={() => void load()}
        onRetryDetail={(policyId) => {
          setDetail({ status: "loading" });
          setExpandedPolicyId(policyId);
        }}
        onSearch={(event) => {
          event.preventDefault();
          updateQuery({ search: searchInput.trim() });
        }}
        onSearchInput={setSearchInput}
        onToggleDetail={toggleDetail}
        pending={pending}
        query={query}
        searchInput={searchInput}
        state={state}
      />
      <PolicyCorrectionDialog
        assignmentOptions={assignmentOptions}
        dialog={dialog}
        key={dialog === null ? "closed" : `${dialog.kind}:${dialog.item.policy.id}:${dialog.item.policy.updatedAt}`}
        onCancel={() => {
          if (!pending) setDialog(null);
        }}
        onSubmit={(input) => void submitCorrection(input)}
        pending={pending}
      />
    </>
  );
}

export function PolicyLedgerView({
  detail,
  expandedPolicyId,
  notice,
  onCorrect,
  onPage,
  onQuery,
  onRetry,
  onRetryDetail,
  onSearch,
  onSearchInput,
  onToggleDetail,
  pending,
  query,
  searchInput,
  state,
}: {
  detail: PolicyLedgerDetailState;
  expandedPolicyId: string | null;
  notice: string | null;
  onCorrect(item: PolicyLedgerItem, kind: "general" | "override"): void;
  onPage(offset: number): void;
  onQuery(query: Partial<PolicyLedgerListQuery>): void;
  onRetry(): void;
  onRetryDetail(policyId: string): void;
  onSearch(event: FormEvent<HTMLFormElement>): void;
  onSearchInput(value: string): void;
  onToggleDetail(policyId: string): void;
  pending: boolean;
  query: PolicyLedgerListQuery;
  searchInput: string;
  state: PolicyLedgerState;
}) {
  if (state.status === "loading") {
    return (
      <LedgerMessage
        body="Retrieving policies and financial totals..."
        busy
        title="Loading policy ledger"
      />
    );
  }
  if (state.status === "error") {
    return (
      <LedgerMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="The policy ledger could not be loaded."
        title="Policy ledger unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <LedgerMessage
        body="This page is not available for your account."
        title="Policy ledger unavailable"
      />
    );
  }

  const pageStart = state.data.filteredTotal === 0 ? 0 : state.data.offset + 1;
  const pageEnd = Math.min(
    state.data.offset + state.data.items.length,
    state.data.filteredTotal,
  );
  return (
    <section className="ledger-page" aria-labelledby="ledger-page-title">
      <header className="ledger-page-header">
        <div>
          <p>Agency financial record</p>
          <h1 id="ledger-page-title">Policy Ledger</h1>
        </div>
        <div className="ledger-record-count" aria-label={`${state.data.filteredTotal} matching policies`}>
          <strong>{state.data.filteredTotal}</strong>
          <span>Policies</span>
        </div>
      </header>

      <LedgerMetrics totals={state.data.totals} />

      <div className="ledger-toolbar">
        <form className="ledger-search" onSubmit={onSearch} role="search">
          <label htmlFor="ledger-search">Search policies</label>
          <div>
            <input
              id="ledger-search"
              maxLength={200}
              onChange={(event) => onSearchInput(event.currentTarget.value)}
              placeholder="Insured, policy, carrier, MGA"
              type="search"
              value={searchInput}
            />
            <button disabled={pending} type="submit">Search</button>
          </div>
        </form>
        <label className="ledger-filter-field">
          <span>Month</span>
          <input
            onChange={(event) => onQuery({ month: event.currentTarget.value })}
            type="month"
            value={query.month ?? ""}
          />
        </label>
        <label className="ledger-filter-field">
          <span>Sort by</span>
          <select
            onChange={(event) => onQuery({ sort: event.currentTarget.value as PolicyLedgerListQuery["sort"] })}
            value={query.sort}
          >
            {POLICY_LEDGER_SORTS.map((sort) => (
              <option key={sort} value={sort}>{ledgerSortLabel(sort)}</option>
            ))}
          </select>
        </label>
        <label className="ledger-filter-field">
          <span>Direction</span>
          <select
            onChange={(event) => onQuery({ direction: event.currentTarget.value as "asc" | "desc" })}
            value={query.direction ?? "desc"}
          >
            <option value="desc">{directionLabel(query.sort, "desc")}</option>
            <option value="asc">{directionLabel(query.sort, "asc")}</option>
          </select>
        </label>
      </div>

      <div className="ledger-filter-strip">
        <div className="ledger-segmented" aria-label="Financing filter">
          {POLICY_LEDGER_FINANCE_FILTERS.map((finance) => (
            <button
              aria-pressed={query.finance === finance}
              disabled={pending}
              key={finance}
              onClick={() => onQuery({ finance })}
              type="button"
            >
              {financeFilterLabel(finance)}
            </button>
          ))}
        </div>
        <label className="ledger-duplicate-toggle">
          <input
            checked={query.duplicates === "only"}
            disabled={pending}
            onChange={(event) => onQuery({ duplicates: event.currentTarget.checked ? "only" : "all" })}
            type="checkbox"
          />
          <span>Duplicates only</span>
        </label>
      </div>

      {notice === null ? null : (
        <div className="ledger-notice" role="status">{notice}</div>
      )}

      {state.data.items.length === 0 ? (
        <div className="ledger-empty">
          <h2>{state.data.total === 0 ? "No policies yet" : "No matching policies"}</h2>
          <p>
            {state.data.total === 0
              ? "Approved policies will appear here."
              : "Adjust the search or filters to see more policies."}
          </p>
        </div>
      ) : (
        <div className="ledger-table" role="table" aria-label="Policy ledger">
          <div className="ledger-table-header" role="row">
            <span role="columnheader">Approved</span>
            <span role="columnheader">Policy</span>
            <span role="columnheader">Placement</span>
            <span role="columnheader">Account</span>
            <span role="columnheader">Agency financials</span>
            <span role="columnheader">Status</span>
            <span aria-hidden="true" />
          </div>
          {state.data.items.map((item) => (
            <LedgerRow
              detail={expandedPolicyId === item.policy.id ? detail : { status: "closed" }}
              expanded={expandedPolicyId === item.policy.id}
              item={item}
              key={item.policy.id}
              onCorrect={onCorrect}
              onRetryDetail={onRetryDetail}
              onToggle={onToggleDetail}
              pending={pending}
            />
          ))}
        </div>
      )}

      <footer className="ledger-pagination" aria-label="Policy ledger pagination">
        <span>{pageStart}-{pageEnd} of {state.data.filteredTotal}</span>
        <div>
          <button
            disabled={pending || state.data.offset === 0}
            onClick={() => onPage(Math.max(0, state.data.offset - state.data.limit))}
            type="button"
          >
            Previous
          </button>
          <button
            disabled={pending || !state.data.hasMore}
            onClick={() => onPage(state.data.offset + state.data.limit)}
            type="button"
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  );
}

function LedgerMetrics({ totals }: { totals: PolicyLedgerListResponse["totals"] }) {
  const metrics = [
    ["Agency revenue", totals.agencyRevenue],
    ["Sophia retained", totals.sophiaRetained],
    ["Producer payout", totals.producerPayout],
    ["Amount collected", totals.amountPaid],
  ] as const;
  return (
    <div className="ledger-metrics" aria-label="Ledger totals">
      {metrics.map(([label, value]) => (
        <div className="ledger-metric" key={label}>
          <span>{label}</span>
          <strong>{formatMoneyExact(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function LedgerRow({
  detail,
  expanded,
  item,
  onCorrect,
  onRetryDetail,
  onToggle,
  pending,
}: {
  detail: PolicyLedgerDetailState;
  expanded: boolean;
  item: PolicyLedgerItem;
  onCorrect(item: PolicyLedgerItem, kind: "general" | "override"): void;
  onRetryDetail(policyId: string): void;
  onToggle(policyId: string): void;
  pending: boolean;
}) {
  return (
    <div className="ledger-row-group" role="rowgroup">
      <div className="ledger-table-row" role="row">
        <span className="ledger-row-date" data-label="Approved" role="cell">
          {shortDate(item.policy.approvedAt)}
        </span>
        <span className="ledger-row-policy" data-label="Policy" role="cell">
          <strong>{item.policy.insuredName}</strong>
          <small>{item.policy.policyNumber} · {item.labels.policyTypeName}</small>
        </span>
        <span className="ledger-row-placement" data-label="Placement" role="cell">
          <strong>{item.labels.carrierName}</strong>
          <small>{item.labels.mgaName} · {item.labels.officeName}</small>
        </span>
        <span className="ledger-row-account" data-label="Account" role="cell">
          <strong>{ledgerAccountLabel(item)}</strong>
          <small>{item.labels.submitterDisplayName}</small>
        </span>
        <span className="ledger-row-money" data-label="Agency financials" role="cell">
          <strong>{formatMoneyExact(item.policy.commissionAmount)}</strong>
          <small>{formatMoneyExact(item.policy.brokerFee)} fee · {formatMoneyExact(item.policy.netDue)} net</small>
        </span>
        <span className="ledger-row-badges" data-label="Status" role="cell">
          {ledgerBadges(item).map((badge) => (
            <span className={`ledger-badge is-${badge.tone}`} key={badge.label}>{badge.label}</span>
          ))}
        </span>
        <span className="ledger-row-expand" role="cell">
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${item.policy.insuredName}`}
            disabled={pending}
            onClick={() => onToggle(item.policy.id)}
            title={expanded ? "Collapse details" : "Expand details"}
            type="button"
          >
            {expanded ? "−" : "+"}
          </button>
        </span>
      </div>
      {expanded ? (
        <LedgerDetail
          detail={detail}
          onCorrect={onCorrect}
          onRetry={() => onRetryDetail(item.policy.id)}
          pending={pending}
        />
      ) : null}
    </div>
  );
}

function LedgerDetail({
  detail,
  onCorrect,
  onRetry,
  pending,
}: {
  detail: PolicyLedgerDetailState;
  onCorrect(item: PolicyLedgerItem, kind: "general" | "override"): void;
  onRetry(): void;
  pending: boolean;
}) {
  if (detail.status === "loading" || detail.status === "closed") {
    return <div className="ledger-detail-message" role="status">Loading policy details...</div>;
  }
  if (detail.status === "error") {
    return (
      <div className="ledger-detail-message is-error">
        <span>Policy details could not be loaded.</span>
        <button onClick={onRetry} type="button">Try again</button>
      </div>
    );
  }
  const currentItem = detail.data.item;
  return (
    <div className="ledger-detail">
      <div className="ledger-detail-groups">
        {LEDGER_DETAIL_GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.fields.map((field) => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>{ledgerDetailValue(currentItem.policy, field)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="ledger-detail-actions">
        <button disabled={pending} onClick={() => onCorrect(currentItem, "general")} type="button">
          Correct fields
        </button>
        <button className="is-override" disabled={pending} onClick={() => onCorrect(currentItem, "override")} type="button">
          Financial override
        </button>
      </div>
    </div>
  );
}

function LedgerMessage({
  action,
  body,
  busy = false,
  title,
}: {
  action?: React.ReactNode;
  body: string;
  busy?: boolean;
  title: string;
}) {
  return (
    <section aria-busy={busy || undefined} className="ledger-message">
      <h1>{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );
}

function ledgerSortLabel(sort: (typeof POLICY_LEDGER_SORTS)[number]): string {
  switch (sort) {
    case "date": return "Approved date";
    case "insured": return "Insured";
    case "mga": return "MGA";
    case "transaction": return "Transaction";
    case "submitter": return "Submitted by";
    case "account": return "Account";
  }
}

function financeFilterLabel(filter: (typeof POLICY_LEDGER_FINANCE_FILTERS)[number]): string {
  switch (filter) {
    case "all": return "All policies";
    case "financed": return "Financed";
    case "ipfs_pending": return "IPFS pending";
    case "ipfs_completed": return "IPFS completed";
  }
}

function directionLabel(
  sort: (typeof POLICY_LEDGER_SORTS)[number],
  direction: "asc" | "desc",
): string {
  if (sort === "date") return direction === "desc" ? "Newest first" : "Oldest first";
  return direction === "asc" ? "A to Z" : "Z to A";
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
