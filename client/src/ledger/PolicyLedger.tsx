import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftAssignmentOption } from "../../../shared/draft-assignment-options.js";
import type {
  DeletedPolicyLedgerItem,
  DeletedPolicyListResponse,
} from "../../../shared/policy-deletions.js";
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
import { EmptyState } from "../ui/EmptyState.js";
import { PageHeader } from "../ui/PageHeader.js";
import {
  PolicyCorrectionDialog,
  type LedgerCorrectionDialog,
} from "./CorrectionDialogs.js";
import { PolicyLedgerApiError, createPolicyLedgerApi } from "./api.js";
import { IpfsExportResources } from "./ipfs-export-resource.js";
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

export type DeletedPolicyState =
  | { status: "closed" }
  | { status: "error" }
  | { status: "loading" }
  | { data: DeletedPolicyListResponse; status: "ready" };

type PolicyDeletionDialog =
  | { item: PolicyLedgerItem; kind: "delete" }
  | { item: DeletedPolicyLedgerItem; kind: "restore" };

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
    direction: "asc",
    duplicates: "all",
    finance: "all",
    limit: INITIAL_LIMIT,
    month: currentLedgerMonth(),
    offset: 0,
    search: "",
    sort: "insured",
  }));
  const [searchInput, setSearchInput] = useState("");
  const [state, setState] = useState<PolicyLedgerState>({ status: "loading" });
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PolicyLedgerDetailState>({ status: "closed" });
  const [assignmentOptions, setAssignmentOptions] = useState<readonly DraftAssignmentOption[]>([]);
  const [dialog, setDialog] = useState<LedgerCorrectionDialog | null>(null);
  const [deletionDialog, setDeletionDialog] = useState<PolicyDeletionDialog | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [deletedState, setDeletedState] = useState<DeletedPolicyState>({ status: "closed" });
  const [pending, setPending] = useState(false);
  const [exportingIpfs, setExportingIpfs] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const deletedVersion = useRef(0);
  const pendingRef = useRef(false);
  const exportingIpfsRef = useRef(false);
  const ipfsExportResources = useRef<IpfsExportResources | null>(null);
  if (ipfsExportResources.current === null) {
    ipfsExportResources.current = new IpfsExportResources();
  }

  useEffect(() => () => ipfsExportResources.current?.dispose(), []);

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

  const loadDeleted = useCallback(async () => {
    const version = deletedVersion.current + 1;
    deletedVersion.current = version;
    setDeletedState({ status: "loading" });
    try {
      const data = await api.listDeleted();
      if (deletedVersion.current === version) {
        setDeletedState({ data, status: "ready" });
      }
    } catch (error) {
      if (deletedVersion.current !== version) return;
      if (error instanceof PolicyLedgerApiError && error.kind === "denied") {
        listVersion.current += 1;
        setState({ status: "denied" });
        setDeletedOpen(false);
        setDeletedState({ status: "closed" });
      } else {
        setDeletedState({ status: "error" });
      }
    }
  }, [api]);

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
    deletedVersion.current += 1;
    setState({ status: "loading" });
    setExpandedPolicyId(null);
    setDetail({ status: "closed" });
    setAssignmentOptions([]);
    setDialog(null);
    setDeletionDialog(null);
    setDeletedOpen(false);
    setDeletedState({ status: "closed" });
    setNotice(null);
    pendingRef.current = false;
    exportingIpfsRef.current = false;
    setPending(false);
    setExportingIpfs(false);
    ipfsExportResources.current?.dispose();
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

  const submitDeletion = useCallback(
    async (reason: string) => {
      if (deletionDialog === null || pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      const policyId = deletionDialog.item.policy.id;
      try {
        if (deletionDialog.kind === "delete") {
          await api.softDelete(policyId, {
            expectedUpdatedAt: deletionDialog.item.policy.updatedAt,
            reason,
          });
          setNotice("Policy moved to deleted records. Closed history was preserved.");
          setExpandedPolicyId(null);
          setDetail({ status: "closed" });
        } else {
          await api.restore(policyId, {
            expectedUpdatedAt: deletionDialog.item.policy.updatedAt,
          });
          setNotice("Policy restored to live records.");
        }
        setDeletionDialog(null);
        await load();
        if (deletedOpen) await loadDeleted();
      } catch (error) {
        setDeletionDialog(null);
        if (error instanceof PolicyLedgerApiError && error.kind === "denied") {
          listVersion.current += 1;
          setState({ status: "denied" });
          setDeletedOpen(false);
          setDeletedState({ status: "closed" });
          setNotice(null);
        } else if (
          error instanceof PolicyLedgerApiError && error.kind === "conflict"
        ) {
          setNotice("This policy changed. The ledger has been refreshed.");
          await load();
          if (deletedOpen) await loadDeleted();
        } else if (
          error instanceof PolicyLedgerApiError && error.kind === "rejected"
        ) {
          setNotice("The policy action was rejected. Review the request and try again.");
        } else {
          setNotice("The policy action could not be completed. Try again.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [api, deletedOpen, deletionDialog, load, loadDeleted],
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

  const updateSearch = useCallback(
    (value: string) => {
      setSearchInput(value);
      updateQuery({ search: value });
    },
    [updateQuery],
  );

  const exportIpfsWorkQueue = useCallback(async () => {
    if (exportingIpfsRef.current) return;
    exportingIpfsRef.current = true;
    setExportingIpfs(true);
    setNotice(null);
    try {
      const document = await api.downloadIpfsWorkQueue();
      ipfsExportResources.current?.download(document);
      setNotice("IPFS work queue downloaded.");
    } catch (error) {
      if (error instanceof PolicyLedgerApiError && error.kind === "denied") {
        listVersion.current += 1;
        setState({ status: "denied" });
        setNotice(null);
      } else if (error instanceof PolicyLedgerApiError && error.kind === "conflict") {
        setNotice("No IPFS-financed policies are pending automation.");
      } else {
        setNotice("The IPFS work queue could not be downloaded. Try again.");
      }
    } finally {
      exportingIpfsRef.current = false;
      setExportingIpfs(false);
    }
  }, [api]);

  const setIpfsPushed = useCallback(
    async (item: PolicyLedgerItem, pushed: boolean) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      try {
        const response = await api.setIpfsPushed(item.policy.id, {
          expectedUpdatedAt: item.policy.updatedAt,
          pushed,
        });
        setDetail({ data: { item: response.item }, status: "ready" });
        setNotice(
          response.changed
            ? pushed
              ? "Policy marked pushed through to IPFS."
              : "IPFS pushed status removed."
            : "IPFS pushed status was already up to date.",
        );
        await load();
      } catch (error) {
        if (error instanceof PolicyLedgerApiError && error.kind === "denied") {
          listVersion.current += 1;
          setState({ status: "denied" });
          setExpandedPolicyId(null);
          setDetail({ status: "closed" });
          setNotice(null);
        } else if (
          error instanceof PolicyLedgerApiError && error.kind === "conflict"
        ) {
          setNotice("This policy changed. The ledger has been refreshed.");
          await load();
          if (expandedPolicyId === item.policy.id) {
            setDetail({ status: "loading" });
          }
        } else if (
          error instanceof PolicyLedgerApiError && error.kind === "rejected"
        ) {
          setNotice("Only IPFS-financed policies can use pushed status.");
        } else {
          setNotice("The IPFS pushed status could not be saved. Try again.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [api, expandedPolicyId, load],
  );

  return (
    <>
      <PolicyLedgerView
        detail={detail}
        expandedPolicyId={expandedPolicyId}
        notice={notice}
        onCorrect={(item, kind) => setDialog({ item, kind })}
        onDelete={(item) => setDeletionDialog({ item, kind: "delete" })}
        onExportIpfs={() => void exportIpfsWorkQueue()}
        onOpenDeleted={() => {
          setDeletedOpen(true);
          void loadDeleted();
        }}
        onSetIpfsPushed={(item, pushed) =>
          void setIpfsPushed(item, pushed)
        }
        onPage={(offset) => setQuery((current) => ({ ...current, offset }))}
        onQuery={updateQuery}
        onRetry={() => void load()}
        onRetryDetail={(policyId) => {
          setDetail({ status: "loading" });
          setExpandedPolicyId(policyId);
        }}
        onSearch={updateSearch}
        onToggleDetail={toggleDetail}
        pending={pending}
        exportingIpfs={exportingIpfs}
        query={query}
        searchInput={searchInput}
        state={state}
      />
      <PolicyCorrectionDialog
        assignmentOptions={assignmentOptions}
        dialog={dialog}
        key={
          dialog === null
            ? "correction:closed"
            : `correction:${dialog.kind}:${dialog.item.policy.id}:${dialog.item.policy.updatedAt}`
        }
        onCancel={() => {
          if (!pending) setDialog(null);
        }}
        onSubmit={(input) => void submitCorrection(input)}
        pending={pending}
      />
      <DeletedPolicyPanel
        onClose={() => {
          deletedVersion.current += 1;
          setDeletedOpen(false);
          setDeletedState({ status: "closed" });
        }}
        onRestore={(item) => setDeletionDialog({ item, kind: "restore" })}
        onRetry={() => void loadDeleted()}
        open={deletedOpen}
        pending={pending}
        state={deletedState}
      />
      <PolicyDeletionDialogView
        dialog={deletionDialog}
        key={
          deletionDialog === null
            ? "deletion:closed"
            : `deletion:${deletionDialog.kind}:${deletionDialog.item.policy.id}:${deletionDialog.item.policy.updatedAt}`
        }
        onCancel={() => {
          if (!pending) setDeletionDialog(null);
        }}
        onSubmit={(reason) => void submitDeletion(reason)}
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
  onDelete,
  onExportIpfs,
  onOpenDeleted,
  onPage,
  onQuery,
  onRetry,
  onRetryDetail,
  onSearch,
  onSetIpfsPushed,
  onToggleDetail,
  pending,
  exportingIpfs,
  query,
  searchInput,
  state,
}: {
  detail: PolicyLedgerDetailState;
  expandedPolicyId: string | null;
  notice: string | null;
  onCorrect(item: PolicyLedgerItem, kind: "general" | "override"): void;
  onDelete(item: PolicyLedgerItem): void;
  onExportIpfs(): void;
  onOpenDeleted(): void;
  onPage(offset: number): void;
  onQuery(query: Partial<PolicyLedgerListQuery>): void;
  onRetry(): void;
  onRetryDetail(policyId: string): void;
  onSearch(value: string): void;
  onSetIpfsPushed(item: PolicyLedgerItem, pushed: boolean): void;
  onToggleDetail(policyId: string): void;
  pending: boolean;
  exportingIpfs: boolean;
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
      <PageHeader
        actions={(
          <div className="ledger-page-actions">
            <button className="ledger-deleted-button" disabled={pending || exportingIpfs} onClick={onExportIpfs} type="button">
              {exportingIpfs ? "Preparing CSV..." : "Export IPFS CSV"}
            </button>
            <button className="ledger-deleted-button" disabled={pending || exportingIpfs} onClick={onOpenDeleted} type="button">
              Deleted policies
            </button>
          </div>
        )}
        eyebrow="Agency financial record"
        status={(
          <>
            <strong>{state.data.filteredTotal}</strong> {state.data.filteredTotal === 1 ? "policy matches" : "policies match"} the current view.
          </>
        )}
        title="Policy Ledger"
        titleId="ledger-page-title"
      />

      <LedgerMetrics totals={state.data.totals} />

      <div className="ledger-toolbar">
        <div className="ledger-search" role="search">
          <label htmlFor="ledger-search">Search policies</label>
          <div>
            <input
              autoComplete="off"
              id="ledger-search"
              maxLength={200}
              onChange={(event) => onSearch(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                onSearch("");
              }}
              placeholder="Insured, policy, carrier, MGA"
              type="search"
              value={searchInput}
            />
            {searchInput === "" ? null : (
              <button
                aria-label="Clear ledger search"
                disabled={pending}
                onClick={() => onSearch("")}
                type="button"
              >
                Clear
              </button>
            )}
          </div>
        </div>
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
            value={query.direction ?? (query.sort === "date" ? "desc" : "asc")}
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
        <EmptyState
          action={state.data.total === 0 ? (
            <a href="#/turn-in">Start a turn-in</a>
          ) : (
            <button
              disabled={pending}
              onClick={() => {
                onSearch("");
                onQuery({
                  direction: "asc",
                  duplicates: "all",
                  finance: "all",
                  month: undefined,
                  sort: "insured",
                });
              }}
              type="button"
            >
              Clear filters
            </button>
          )}
          body={state.data.total === 0
            ? "Approved policies will appear here after a turn-in is completed and added to the ledger."
            : "Try another insured, policy number, carrier, MGA, or month."}
          className="ledger-empty"
          heading={state.data.total === 0 ? "No policies in the ledger" : "No policies match these filters"}
        />
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
              onDelete={onDelete}
              onRetryDetail={onRetryDetail}
              onSetIpfsPushed={onSetIpfsPushed}
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
    ["Collected", totals.amountPaid],
    ["Commission", totals.commissionAmount],
    ["Broker fees", totals.brokerFee],
    ["Agency revenue", totals.agencyRevenue],
    ["Producer share", totals.producerPayout],
    ["Sophia share", totals.sophiaRetained],
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
  onDelete,
  onRetryDetail,
  onSetIpfsPushed,
  onToggle,
  pending,
}: {
  detail: PolicyLedgerDetailState;
  expanded: boolean;
  item: PolicyLedgerItem;
  onCorrect(item: PolicyLedgerItem, kind: "general" | "override"): void;
  onDelete(item: PolicyLedgerItem): void;
  onRetryDetail(policyId: string): void;
  onSetIpfsPushed(item: PolicyLedgerItem, pushed: boolean): void;
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
          onDelete={onDelete}
          onRetry={() => onRetryDetail(item.policy.id)}
          onSetIpfsPushed={onSetIpfsPushed}
          pending={pending}
        />
      ) : null}
    </div>
  );
}

function LedgerDetail({
  detail,
  onCorrect,
  onDelete,
  onRetry,
  onSetIpfsPushed,
  pending,
}: {
  detail: PolicyLedgerDetailState;
  onCorrect(item: PolicyLedgerItem, kind: "general" | "override"): void;
  onDelete(item: PolicyLedgerItem): void;
  onRetry(): void;
  onSetIpfsPushed(item: PolicyLedgerItem, pushed: boolean): void;
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
                  <dd>{ledgerDetailValue(currentItem, field)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="ledger-detail-actions">
        {currentItem.policy.paymentMode === "deposit" &&
        currentItem.policy.ipfsFinanced === "yes" ? (
          <button
            className={currentItem.policy.ipfsPushed ? "is-ipfs-pushed" : "is-ipfs"}
            disabled={pending}
            onClick={() =>
              onSetIpfsPushed(currentItem, !currentItem.policy.ipfsPushed)
            }
            title={
              currentItem.policy.ipfsPushed
                ? "Undo pushed-through status"
                : "Mark once the finance agreement is signed and sent to IPFS"
            }
            type="button"
          >
            {currentItem.policy.ipfsPushed
              ? `✓ Pushed through to IPFS${
                  currentItem.policy.ipfsPushedAt === null
                    ? ""
                    : ` · ${shortDate(currentItem.policy.ipfsPushedAt)}`
                }`
              : "Mark pushed through to IPFS"}
          </button>
        ) : null}
        <button disabled={pending} onClick={() => onCorrect(currentItem, "general")} type="button">
          Correct fields
        </button>
        <button className="is-override" disabled={pending} onClick={() => onCorrect(currentItem, "override")} type="button">
          Financial override
        </button>
        <button className="is-danger" disabled={pending} onClick={() => onDelete(currentItem)} type="button">
          Delete policy
        </button>
      </div>
    </div>
  );
}

export function DeletedPolicyPanel({
  onClose,
  onRestore,
  onRetry,
  open,
  pending,
  state,
}: {
  onClose(): void;
  onRestore(item: DeletedPolicyLedgerItem): void;
  onRetry(): void;
  open: boolean;
  pending: boolean;
  state: DeletedPolicyState;
}) {
  if (!open) return null;
  return (
    <div className="ledger-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="deleted-policy-title"
        aria-modal="true"
        className="ledger-dialog is-wide ledger-deleted-panel"
        role="dialog"
      >
        <header>
          <div>
            <p>Recoverable records</p>
            <h2 id="deleted-policy-title">Deleted policies</h2>
          </div>
          <button
            aria-label="Close deleted policies"
            disabled={pending}
            onClick={onClose}
            title="Close"
            type="button"
          >
            ×
          </button>
        </header>
        {state.status === "loading" || state.status === "closed" ? (
          <p className="ledger-deleted-status" role="status">
            Loading deleted policies...
          </p>
        ) : state.status === "error" ? (
          <div className="ledger-deleted-status is-error">
            <p>Deleted policies could not be loaded.</p>
            <button disabled={pending} onClick={onRetry} type="button">
              Try again
            </button>
          </div>
        ) : state.data.items.length === 0 ? (
          <p className="ledger-deleted-status">No deleted policies.</p>
        ) : (
          <div className="ledger-deleted-list">
            {state.data.items.map((item) => (
              <article key={item.policy.id}>
                <div>
                  <strong>{item.policy.insuredName}</strong>
                  <span>
                    {item.policy.policyNumber} · {item.labels.policyTypeName}
                  </span>
                  <small>
                    Deleted {shortDate(item.deletion.deletedAt)} · {item.deletion.reason}
                  </small>
                </div>
                <button
                  disabled={pending}
                  onClick={() => onRestore(item)}
                  type="button"
                >
                  Restore
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PolicyDeletionDialogView({
  dialog,
  onCancel,
  onSubmit,
  pending,
}: {
  dialog: PolicyDeletionDialog | null;
  onCancel(): void;
  onSubmit(reason: string): void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  if (dialog === null) return null;
  const deleting = dialog.kind === "delete";
  const submit = () => {
    const normalizedReason = reason.trim();
    if (deleting && normalizedReason.length === 0) {
      setInvalid(true);
      return;
    }
    onSubmit(normalizedReason);
  };
  return (
    <div className="ledger-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="policy-deletion-dialog-title"
        aria-modal="true"
        className="ledger-dialog"
        role="dialog"
      >
        <header>
          <h2 id="policy-deletion-dialog-title">
            {deleting ? "Delete" : "Restore"} {dialog.item.policy.insuredName}
          </h2>
          <button
            aria-label="Close policy action"
            disabled={pending}
            onClick={onCancel}
            title="Close"
            type="button"
          >
            ×
          </button>
        </header>
        <p className="ledger-deletion-explanation">
          {deleting
            ? "The policy will leave all live views and open pay sheets. Any closed pay-sheet history remains unchanged."
            : "The policy will return to live records. A settled policy will not be placed on a pay sheet again."}
        </p>
        {deleting ? (
          <label className="ledger-dialog-field">
            <span>Required reason</span>
            <textarea
              disabled={pending}
              maxLength={500}
              onChange={(event) => {
                setReason(event.currentTarget.value);
                setInvalid(false);
              }}
              rows={4}
              value={reason}
            />
          </label>
        ) : null}
        {invalid ? (
          <p className="ledger-correction-error" role="alert">
            Enter a reason before deleting this policy.
          </p>
        ) : null}
        <div className="ledger-dialog-actions">
          <button disabled={pending} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className={deleting ? "is-danger" : "is-primary"}
            disabled={pending}
            onClick={submit}
            type="button"
          >
            {pending
              ? deleting
                ? "Deleting..."
                : "Restoring..."
              : deleting
                ? "Delete policy"
                : "Restore policy"}
          </button>
        </div>
      </section>
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
