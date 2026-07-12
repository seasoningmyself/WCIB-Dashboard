import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftAssignmentOption } from "../../../shared/draft-assignment-options.js";
import type { PaySheetAdjustmentInput } from "../../../shared/pay-sheet-adjustment-api.js";
import type {
  PaySheetAdjustmentView,
  PaySheetDetail,
  PaySheetListResponse,
  PaySheetPolicyView,
  PaySheetSummary,
} from "../../../shared/pay-sheet-api.js";
import type { PolicyTypeOption } from "../../../shared/vocabulary.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { formatMoneyExact } from "../ledger/view-state.js";
import { useVocabulary } from "../vocabulary/context.js";
import {
  PaySheetAdjustmentDialog,
  PaySheetCloseDialog,
  type PaySheetAdjustmentDialogState,
} from "./PaySheetDialogs.js";
import {
  PaySheetExportControls,
  PaySheetFullExportDialog,
  type PaySheetExportAction,
  type PaySheetExportUiState,
} from "./PaySheetExportControls.js";
import { createPaySheetsApi, PaySheetsApiError } from "./api.js";
import {
  PaySheetExportPopupBlockedError,
  PaySheetExportResources,
  type ExportPrintWindow,
} from "./export-resources.js";
import {
  adjustmentTypeLabel,
  closedSheetsForOwner,
  detailSourceLabel,
  formatPaySheetDate,
  formatPaySheetPeriod,
  formatPaySheetRate,
  groupPaySheetsByOwner,
  isDirectIncomeAdjustment,
  isPaySheetsAdmin,
  listPaySheetPeriods,
  openSheetForOwner,
  ownerHasPaySheetPeriod,
  paySheetExportQueryForScope,
  paySheetAccountLabel,
  type PaySheetOwnerGroup,
} from "./view-state.js";

export type PaySheetsState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { data: PaySheetListResponse; status: "ready" };

export type PaySheetDetailState =
  | { status: "error" }
  | { status: "loading" }
  | { data: PaySheetDetail; status: "ready" };

export function PaySheets({ user }: { user: CurrentUser }) {
  return isPaySheetsAdmin(user) ? (
    <AdminPaySheets />
  ) : (
    <PaySheetsMessage
      body="This page is not available for your account."
      title="Pay sheets unavailable"
    />
  );
}

function AdminPaySheets() {
  const client = useApiClient();
  const api = useMemo(() => createPaySheetsApi(client), [client]);
  const vocabulary = useVocabulary();
  const [state, setState] = useState<PaySheetsState>({ status: "loading" });
  const [selectedOwnerKey, setSelectedOwnerKey] = useState<string | null>(null);
  const [expandedClosedId, setExpandedClosedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, PaySheetDetailState>>({});
  const detailsRef = useRef(details);
  const [producers, setProducers] = useState<readonly DraftAssignmentOption[]>([]);
  const [closeDialog, setCloseDialog] = useState<PaySheetSummary | null>(null);
  const [adjustmentDialog, setAdjustmentDialog] =
    useState<PaySheetAdjustmentDialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [exportState, setExportState] = useState<PaySheetExportUiState>({
    status: "idle",
  });
  const [exportConfirmation, setExportConfirmation] =
    useState<PaySheetExportAction | null>(null);
  const [selectedExportPeriodKey, setSelectedExportPeriodKey] =
    useState<string | null>(null);
  const exportPendingRef = useRef(false);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportResourcesRef = useRef<PaySheetExportResources | null>(null);
  if (exportResourcesRef.current === null) {
    exportResourcesRef.current = new PaySheetExportResources();
  }
  const listVersion = useRef(0);
  const detailEpoch = useRef(0);

  const updateDetails = useCallback(
    (
      update: (
        current: Record<string, PaySheetDetailState>,
      ) => Record<string, PaySheetDetailState>,
    ) => {
      setDetails((current) => {
        const next = update(current);
        detailsRef.current = next;
        return next;
      });
    },
    [],
  );

  const load = useCallback(
    async (showLoading = true) => {
      const version = listVersion.current + 1;
      listVersion.current = version;
      if (showLoading) setState({ status: "loading" });
      try {
        const data = await api.list();
        if (listVersion.current === version) {
          setState({ data, status: "ready" });
        }
      } catch (error) {
        if (listVersion.current !== version) return;
        setState({
          status:
            error instanceof PaySheetsApiError && error.kind === "denied"
              ? "denied"
              : "error",
        });
      }
    },
    [api],
  );

  const ensureDetail = useCallback(
    async (paySheetId: string, force = false) => {
      const existing = detailsRef.current[paySheetId];
      if (
        !force &&
        (existing?.status === "loading" || existing?.status === "ready")
      ) {
        return;
      }
      const epoch = detailEpoch.current;
      updateDetails((current) => ({
        ...current,
        [paySheetId]: { status: "loading" },
      }));
      try {
        const { sheet } = await api.get(paySheetId);
        if (detailEpoch.current === epoch) {
          updateDetails((current) => ({
            ...current,
            [paySheetId]: { data: sheet, status: "ready" },
          }));
        }
      } catch (error) {
        if (detailEpoch.current !== epoch) return;
        if (error instanceof PaySheetsApiError && error.kind === "denied") {
          listVersion.current += 1;
          detailEpoch.current += 1;
          detailsRef.current = {};
          setDetails({});
          setState({ status: "denied" });
        } else {
          updateDetails((current) => ({
            ...current,
            [paySheetId]: { status: "error" },
          }));
        }
      }
    },
    [api, updateDetails],
  );

  useEffect(() => {
    void load();
    return () => {
      listVersion.current += 1;
      detailEpoch.current += 1;
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    void api
      .listAssignmentOptions()
      .then(({ producers: options }) => {
        if (active) setProducers(options);
      })
      .catch(() => {
        if (active) setProducers([]);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const groups = useMemo(
    () => (state.status === "ready" ? groupPaySheetsByOwner(state.data.items) : []),
    [state],
  );
  const activeGroup =
    groups.find(({ key }) => key === selectedOwnerKey) ?? groups[0] ?? null;
  const exportPeriods = useMemo(
    () => (state.status === "ready" ? listPaySheetPeriods(state.data.items) : []),
    [state],
  );
  const selectedExportPeriod =
    exportPeriods.find(({ key }) => key === selectedExportPeriodKey) ??
    exportPeriods[0] ??
    null;

  useEffect(() => {
    if (activeGroup !== null && selectedOwnerKey !== activeGroup.key) {
      setSelectedOwnerKey(activeGroup.key);
    }
  }, [activeGroup, selectedOwnerKey]);

  useEffect(() => {
    if (activeGroup === null) return;
    const open = openSheetForOwner(activeGroup);
    if (open !== null) void ensureDetail(open.id);
  }, [activeGroup, ensureDetail]);

  useEffect(() => {
    if (
      selectedExportPeriod !== null &&
      selectedExportPeriodKey !== selectedExportPeriod.key
    ) {
      setSelectedExportPeriodKey(selectedExportPeriod.key);
    }
  }, [selectedExportPeriod, selectedExportPeriodKey]);

  useEffect(
    () => () => {
      exportAbortRef.current?.abort();
      exportAbortRef.current = null;
      exportResourcesRef.current?.dispose();
    },
    [],
  );

  const clearSensitiveState = useCallback(() => {
    listVersion.current += 1;
    detailEpoch.current += 1;
    detailsRef.current = {};
    setDetails({});
    setState({ status: "loading" });
    setSelectedOwnerKey(null);
    setExpandedClosedId(null);
    setProducers([]);
    setCloseDialog(null);
    setAdjustmentDialog(null);
    setDialogError(null);
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    exportResourcesRef.current?.dispose();
    exportPendingRef.current = false;
    setExportState({ status: "idle" });
    setExportConfirmation(null);
    setSelectedExportPeriodKey(null);
    setNotice(null);
    pendingRef.current = false;
    setPending(false);
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const runExport = useCallback(
    async (action: PaySheetExportAction) => {
      if (
        exportPendingRef.current ||
        activeGroup === null ||
        selectedExportPeriod === null
      ) {
        return;
      }
      const exportQuery = paySheetExportQueryForScope(
        action.scope,
        activeGroup,
        selectedExportPeriod,
      );
      if (exportQuery === null) {
        setExportState({
          message: "This owner has no pay sheet in the selected period.",
          status: "error",
        });
        return;
      }

      const resources = exportResourcesRef.current;
      if (resources === null) return;
      let popup: ExportPrintWindow | null = null;
      if (action.format === "print") {
        try {
          popup = resources.openPrintWindow();
        } catch (error) {
          setExportState({
            message:
              error instanceof PaySheetExportPopupBlockedError
                ? "The print window was blocked. Allow popups and try again."
                : "The print view could not be opened. Try again.",
            status: "error",
          });
          return;
        }
      }

      const abortController = new AbortController();
      exportAbortRef.current = abortController;
      exportPendingRef.current = true;
      setExportState({ action, status: "pending" });
      try {
        const document = await api.exportDocument(
          action.format,
          exportQuery,
          abortController.signal,
        );
        if (action.format === "excel") {
          resources.download(document);
        } else if (popup !== null) {
          resources.print(popup, document);
        }
        setExportState({
          message:
            action.format === "excel"
              ? "Excel download started."
              : "Print view opened. Use the browser print dialog to save as PDF.",
          status: "success",
        });
      } catch (error) {
        if (popup !== null) resources.cancelPrint(popup);
        if (abortController.signal.aborted) {
          setExportState({ status: "idle" });
          return;
        }
        if (error instanceof PaySheetsApiError && error.kind === "denied") {
          clearSensitiveState();
          setState({ status: "denied" });
          return;
        }
        setExportState({
          message:
            error instanceof PaySheetsApiError && error.kind === "conflict"
              ? "No pay sheet matched this owner and period. Refresh and try again."
              : "The report could not be prepared. Try again.",
          status: "error",
        });
      } finally {
        if (exportAbortRef.current === abortController) {
          exportAbortRef.current = null;
        }
        exportPendingRef.current = false;
      }
    },
    [activeGroup, api, clearSensitiveState, selectedExportPeriod],
  );

  const submitClose = useCallback(async () => {
    if (closeDialog === null || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setDialogError(null);
    setNotice(null);
    try {
      const response = await api.close(closeDialog.id);
      updateDetails((current) => ({
        ...current,
        [response.closedSheet.id]: {
          data: response.closedSheet,
          status: "ready",
        },
      }));
      setExpandedClosedId(response.closedSheet.id);
      setCloseDialog(null);
      setNotice(
        response.close.closed
          ? `${formatPaySheetPeriod(response.close.periodMonth, response.close.periodYear)} closed. The next period is open.`
          : "This sheet was already closed. The current periods have been refreshed.",
      );
      await load(false);
    } catch (error) {
      if (error instanceof PaySheetsApiError && error.kind === "denied") {
        clearSensitiveState();
        setState({ status: "denied" });
      } else if (
        error instanceof PaySheetsApiError && error.kind === "conflict"
      ) {
        setCloseDialog(null);
        setNotice("The sheet changed. Current pay-sheet data has been refreshed.");
        await load(false);
      } else if (
        error instanceof PaySheetsApiError && error.kind === "rejected"
      ) {
        setDialogError("This sheet cannot be closed. Review its policies and rate status.");
      } else {
        setDialogError("The sheet could not be closed. Try again.");
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [api, clearSensitiveState, closeDialog, load, updateDetails]);

  const submitAdjustment = useCallback(
    async (input?: PaySheetAdjustmentInput) => {
      if (adjustmentDialog === null || pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setDialogError(null);
      setNotice(null);
      try {
        const response =
          adjustmentDialog.kind === "delete"
            ? await api.deleteAdjustment(adjustmentDialog.adjustment.id)
            : adjustmentDialog.kind === "edit"
              ? await api.updateAdjustment(
                  adjustmentDialog.adjustment.id,
                  requireAdjustmentInput(input),
                )
              : await api.createAdjustment(
                  adjustmentDialog.sheet.id,
                  requireAdjustmentInput(input),
                );
        updateDetails((current) => ({
          ...current,
          [response.sheet.id]: { data: response.sheet, status: "ready" },
        }));
        setAdjustmentDialog(null);
        setNotice(
          adjustmentDialog.kind === "delete"
            ? "Adjustment deleted."
            : adjustmentDialog.kind === "edit"
              ? "Adjustment updated."
              : "Adjustment added.",
        );
        await load(false);
      } catch (error) {
        if (error instanceof PaySheetsApiError && error.kind === "denied") {
          clearSensitiveState();
          setState({ status: "denied" });
        } else if (
          error instanceof PaySheetsApiError && error.kind === "conflict"
        ) {
          setAdjustmentDialog(null);
          setNotice("The sheet changed. Current pay-sheet data has been refreshed.");
          await load(false);
        } else if (
          error instanceof PaySheetsApiError && error.kind === "rejected"
        ) {
          setDialogError("The adjustment was rejected. Review the values and try again.");
        } else {
          setDialogError("The adjustment could not be saved. Try again.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [adjustmentDialog, api, clearSensitiveState, load, updateDetails],
  );

  const policyTypes: readonly PolicyTypeOption[] =
    vocabulary.state.status === "ready"
      ? vocabulary.state.data.policyTypes
      : [];

  return (
    <>
      <PaySheetsView
        details={details}
        expandedClosedId={expandedClosedId}
        exportControls={
          activeGroup === null || selectedExportPeriod === null ? null : (
            <PaySheetExportControls
              activeOwnerAvailable={ownerHasPaySheetPeriod(
                activeGroup,
                selectedExportPeriod,
              )}
              activeOwnerLabel={activeGroup.label}
              disabled={pending}
              onAction={(action) => {
                if (action.scope === "all") {
                  setExportConfirmation(action);
                  return;
                }
                void runExport(action);
              }}
              onPeriod={(periodKey) => {
                setSelectedExportPeriodKey(periodKey);
                setExportConfirmation(null);
                setExportState({ status: "idle" });
              }}
              periods={exportPeriods}
              selectedPeriodKey={selectedExportPeriod.key}
              state={exportState}
            />
          )
        }
        notice={notice}
        onClose={(sheet) => {
          setDialogError(null);
          setCloseDialog(sheet);
        }}
        onOwner={(key) => {
          setSelectedOwnerKey(key);
          setExpandedClosedId(null);
          setAdjustmentDialog(null);
          setCloseDialog(null);
          setDialogError(null);
          setNotice(null);
          setExportConfirmation(null);
          setExportState({ status: "idle" });
        }}
        onOpenAdjustment={(dialog) => {
          setDialogError(null);
          setAdjustmentDialog(dialog);
        }}
        onRetry={() => void load()}
        onRetryDetail={(paySheetId) => void ensureDetail(paySheetId, true)}
        onToggleClosed={(paySheetId) => {
          if (expandedClosedId === paySheetId) {
            setExpandedClosedId(null);
            return;
          }
          setExpandedClosedId(paySheetId);
          void ensureDetail(paySheetId);
        }}
        pending={pending}
        selectedOwnerKey={activeGroup?.key ?? null}
        state={state}
      />
      <PaySheetFullExportDialog
        action={exportConfirmation}
        onCancel={() => {
          if (!exportPendingRef.current) setExportConfirmation(null);
        }}
        onConfirm={() => {
          const action = exportConfirmation;
          if (action !== null) {
            void runExport(action).finally(() => setExportConfirmation(null));
          }
        }}
        pending={exportState.status === "pending"}
        periodLabel={selectedExportPeriod?.label ?? "Selected period"}
      />
      <PaySheetCloseDialog
        error={dialogError}
        onCancel={() => {
          if (!pending) {
            setCloseDialog(null);
            setDialogError(null);
          }
        }}
        onConfirm={() => void submitClose()}
        pending={pending}
        sheet={closeDialog}
      />
      <PaySheetAdjustmentDialog
        dialog={adjustmentDialog}
        error={dialogError}
        key={adjustmentDialogKey(adjustmentDialog)}
        onCancel={() => {
          if (!pending) {
            setAdjustmentDialog(null);
            setDialogError(null);
          }
        }}
        onDelete={() => void submitAdjustment()}
        onSubmit={(input) => void submitAdjustment(input)}
        pending={pending}
        policyTypes={policyTypes}
        producers={producers}
      />
    </>
  );
}

export function PaySheetsView({
  details,
  expandedClosedId,
  exportControls = null,
  notice,
  onClose,
  onOpenAdjustment,
  onOwner,
  onRetry,
  onRetryDetail,
  onToggleClosed,
  pending,
  selectedOwnerKey,
  state,
}: {
  details: Readonly<Record<string, PaySheetDetailState>>;
  expandedClosedId: string | null;
  exportControls?: React.ReactNode;
  notice: string | null;
  onClose(sheet: PaySheetSummary): void;
  onOpenAdjustment(dialog: PaySheetAdjustmentDialogState): void;
  onOwner(key: string): void;
  onRetry(): void;
  onRetryDetail(paySheetId: string): void;
  onToggleClosed(paySheetId: string): void;
  pending: boolean;
  selectedOwnerKey: string | null;
  state: PaySheetsState;
}) {
  if (state.status === "loading") {
    return (
      <PaySheetsMessage
        body="Retrieving open periods and frozen history..."
        busy
        title="Loading pay sheets"
      />
    );
  }
  if (state.status === "error") {
    return (
      <PaySheetsMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="Pay sheets could not be loaded."
        title="Pay sheets unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <PaySheetsMessage
        body="This page is not available for your account."
        title="Pay sheets unavailable"
      />
    );
  }

  const groups = groupPaySheetsByOwner(state.data.items);
  const activeGroup =
    groups.find(({ key }) => key === selectedOwnerKey) ?? groups[0] ?? null;
  return (
    <section className="pay-sheets-page" aria-labelledby="pay-sheets-title">
      <header className="pay-sheets-page-header">
        <div>
          <p>Payroll workspace</p>
          <h1 id="pay-sheets-title">Pay Sheets</h1>
        </div>
        <div className="pay-sheets-period-count">
          <strong>{state.data.items.length}</strong>
          <span>Periods</span>
        </div>
      </header>

      {groups.length === 0 || activeGroup === null ? (
        <div className="pay-sheets-empty">
          <h2>No pay sheets yet</h2>
          <p>Paid MGA policies will populate the open payroll periods.</p>
        </div>
      ) : (
        <>
          <div className="pay-sheet-owner-tabs" aria-label="Pay-sheet owner">
            {groups.map((group) => (
              <button
                aria-pressed={group.key === activeGroup.key}
                disabled={pending}
                key={group.key}
                onClick={() => onOwner(group.key)}
                type="button"
              >
                <span>{group.label}</span>
                <small>{group.ownerType === "sophia" ? "Agency" : "Producer"}</small>
              </button>
            ))}
          </div>

          {exportControls}

          {notice === null ? null : (
            <div className="pay-sheets-notice" role="status">{notice}</div>
          )}

          <OwnerWorkspace
            details={details}
            expandedClosedId={expandedClosedId}
            group={activeGroup}
            onClose={onClose}
            onOpenAdjustment={onOpenAdjustment}
            onRetryDetail={onRetryDetail}
            onToggleClosed={onToggleClosed}
            pending={pending}
          />
        </>
      )}
    </section>
  );
}

function OwnerWorkspace({
  details,
  expandedClosedId,
  group,
  onClose,
  onOpenAdjustment,
  onRetryDetail,
  onToggleClosed,
  pending,
}: {
  details: Readonly<Record<string, PaySheetDetailState>>;
  expandedClosedId: string | null;
  group: PaySheetOwnerGroup;
  onClose(sheet: PaySheetSummary): void;
  onOpenAdjustment(dialog: PaySheetAdjustmentDialogState): void;
  onRetryDetail(paySheetId: string): void;
  onToggleClosed(paySheetId: string): void;
  pending: boolean;
}) {
  const open = openSheetForOwner(group);
  const closed = closedSheetsForOwner(group);
  return (
    <div className="pay-sheet-owner-workspace">
      <section className="pay-sheet-current" aria-labelledby="pay-sheet-current-title">
        <div className="pay-sheet-section-heading">
          <div>
            <p>Current period</p>
            <h2 id="pay-sheet-current-title">
              {open === null
                ? "No open sheet"
                : formatPaySheetPeriod(open.periodMonth, open.periodYear)}
            </h2>
          </div>
          {open === null ? null : (
            <SheetStatus status={open.status} />
          )}
        </div>
        {open === null ? (
          <div className="pay-sheets-empty is-compact">
            <h3>No open period</h3>
            <p>Close history remains available below.</p>
          </div>
        ) : (
          <SheetPanel
            detail={details[open.id]}
            onClose={() => onClose(open)}
            onOpenAdjustment={onOpenAdjustment}
            onRetry={() => onRetryDetail(open.id)}
            pending={pending}
            summary={open}
          />
        )}
      </section>

      <section className="pay-sheet-history" aria-labelledby="pay-sheet-history-title">
        <div className="pay-sheet-section-heading">
          <div>
            <p>Immutable record</p>
            <h2 id="pay-sheet-history-title">Closed history</h2>
          </div>
          <span>{closed.length} periods</span>
        </div>
        {closed.length === 0 ? (
          <div className="pay-sheets-empty is-compact">
            <h3>No closed periods</h3>
            <p>Finalized sheets will appear here.</p>
          </div>
        ) : (
          <div className="pay-sheet-history-list">
            {closed.map((sheet) => {
              const expanded = sheet.id === expandedClosedId;
              return (
                <article className="pay-sheet-history-item" key={sheet.id}>
                  <button
                    aria-expanded={expanded}
                    className="pay-sheet-history-toggle"
                    onClick={() => onToggleClosed(sheet.id)}
                    type="button"
                  >
                    <span>
                      <strong>{formatPaySheetPeriod(sheet.periodMonth, sheet.periodYear)}</strong>
                      <small>Closed {formatPaySheetDate(sheet.closedAt)}</small>
                    </span>
                    <span>
                      <strong>{historyPrimaryTotal(sheet)}</strong>
                      <small>{sheet.policyCount} policies</small>
                    </span>
                    <span aria-hidden="true">{expanded ? "-" : "+"}</span>
                  </button>
                  {expanded ? (
                    <SheetPanel
                      detail={details[sheet.id]}
                      onClose={() => {}}
                      onOpenAdjustment={onOpenAdjustment}
                      onRetry={() => onRetryDetail(sheet.id)}
                      pending={pending}
                      summary={sheet}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SheetPanel({
  detail,
  onClose,
  onOpenAdjustment,
  onRetry,
  pending,
  summary,
}: {
  detail: PaySheetDetailState | undefined;
  onClose(): void;
  onOpenAdjustment(dialog: PaySheetAdjustmentDialogState): void;
  onRetry(): void;
  pending: boolean;
  summary: PaySheetSummary;
}) {
  const open = summary.status === "open";
  return (
    <div className={`pay-sheet-panel ${open ? "is-open" : "is-closed"}`}>
      <PaySheetTotals summary={summary} />
      <div className="pay-sheet-panel-toolbar">
        <span>
          {summary.policyCount} policies / {summary.adjustmentCount} adjustments
        </span>
        {open ? (
          <div>
            <span className="pay-sheet-close-blocker">
              {closeBlockerLabel(summary.closeBlocker)}
            </span>
            <button
              className="pay-sheet-close-button"
              disabled={pending || summary.closeBlocker !== null}
              onClick={onClose}
              type="button"
            >
              Close sheet
            </button>
          </div>
        ) : (
          <span className="pay-sheet-frozen-label">Frozen</span>
        )}
      </div>
      {detail === undefined || detail.status === "loading" ? (
        <DetailMessage body="Loading policy and adjustment detail..." busy />
      ) : detail.status === "error" ? (
        <DetailMessage
          action={<button onClick={onRetry} type="button">Retry detail</button>}
          body="Sheet detail could not be loaded."
        />
      ) : (
        <PaySheetDetailView
          onOpenAdjustment={onOpenAdjustment}
          pending={pending}
          sheet={detail.data}
        />
      )}
    </div>
  );
}

function PaySheetTotals({ summary }: { summary: PaySheetSummary }) {
  if (summary.totals === null) {
    return (
      <div className="pay-sheet-rate-warning" role="status">
        A producer rate effective for this period is required before totals can
        be finalized.
      </div>
    );
  }
  const metrics =
    summary.ownerType === "sophia"
      ? [
          ["Agency gross", summary.totals.sophiaAgencyGross],
          ["Sophia take-home", summary.totals.sophiaTakeHome],
          ["Sophia share", summary.totals.sophiaShare],
          ["Trust pull", summary.totals.trustPull],
          ["Direct income", summary.totals.directCheckAchIncome],
        ]
      : [
          ["Producer payout", summary.totals.producerPayout],
          ["Trust pull", summary.totals.trustPull],
          ["Commission", summary.totals.commissions],
          ["Broker fees", summary.totals.brokerFees],
        ];
  return (
    <dl className="pay-sheet-totals" aria-label={`${summary.ownerDisplayName} totals`}>
      {metrics.map(([label, value], index) => (
        <div className={index === 0 ? "is-primary" : ""} key={label}>
          <dt>{label}</dt>
          <dd>{formatMoneyExact(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PaySheetDetailView({
  onOpenAdjustment,
  pending,
  sheet,
}: {
  onOpenAdjustment(dialog: PaySheetAdjustmentDialogState): void;
  pending: boolean;
  sheet: PaySheetDetail;
}) {
  const open = sheet.status === "open";
  return (
    <div className="pay-sheet-detail">
      <div className="pay-sheet-source-strip">
        <span>{detailSourceLabel(sheet)}</span>
        {sheet.status === "closed" ? (
          <span>Closed {formatPaySheetDate(sheet.closedAt)}</span>
        ) : null}
      </div>
      <RateContext sheet={sheet} />
      <PolicyTable policies={sheet.policies} sheet={sheet} />
      <AdjustmentTable
        onOpen={onOpenAdjustment}
        pending={pending}
        sheet={sheet}
      />
      {open ? (
        <div className="pay-sheet-add-actions">
          <button
            disabled={pending}
            onClick={() =>
              onOpenAdjustment({ kind: "create", mode: "correction", sheet })
            }
            type="button"
          >
            Add correction
          </button>
          {sheet.ownerType === "sophia" ? (
            <button
              disabled={pending}
              onClick={() =>
                onOpenAdjustment({
                  kind: "create",
                  mode: "direct_income",
                  sheet,
                })
              }
              type="button"
            >
              Add direct income
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RateContext({ sheet }: { sheet: PaySheetDetail }) {
  if (sheet.ownerType !== "producer") return null;
  const rate = sheet.policies.find((policy) => policy.rate !== null)?.rate ?? null;
  if (rate === null) {
    return <div className="pay-sheet-rate-warning">No effective producer rate</div>;
  }
  return (
    <section className="pay-sheet-rate" aria-label="Producer payout rate">
      <header>
        <strong>{sheet.status === "closed" ? "Frozen payout rate" : "Current payout rate"}</strong>
        <span>Effective {rate.effectiveDate}</span>
      </header>
      <dl>
        <div><dt>New commission</dt><dd>{formatPaySheetRate(rate.newCommissionRate)}</dd></div>
        <div><dt>Renewal commission</dt><dd>{formatPaySheetRate(rate.renewalCommissionRate)}</dd></div>
        <div><dt>New broker</dt><dd>{formatPaySheetRate(rate.newBrokerRate)}</dd></div>
        <div><dt>Renewal broker</dt><dd>{formatPaySheetRate(rate.renewalBrokerRate)}</dd></div>
      </dl>
    </section>
  );
}

function PolicyTable({
  policies,
  sheet,
}: {
  policies: readonly PaySheetPolicyView[];
  sheet: PaySheetDetail;
}) {
  return (
    <section className="pay-sheet-data-section" aria-labelledby={`policies-${sheet.id}`}>
      <header>
        <h3 id={`policies-${sheet.id}`}>Policies</h3>
        <span>{policies.length}</span>
      </header>
      {policies.length === 0 ? (
        <div className="pay-sheet-inline-empty">No policies on this sheet.</div>
      ) : (
        <div className="pay-sheet-policy-table" role="table" aria-label="Pay-sheet policies">
          <div className="pay-sheet-policy-header" role="row">
            <span role="columnheader">Insured</span>
            <span role="columnheader">Policy</span>
            <span role="columnheader">Revenue</span>
            <span role="columnheader">Commission</span>
            <span role="columnheader">Broker fee</span>
            <span role="columnheader">
              {sheet.ownerType === "sophia" ? "Sophia share" : "Producer payout"}
            </span>
          </div>
          {policies.map((policy) => (
            <div className="pay-sheet-policy-row" key={policy.associationId} role="row">
              <span data-label="Insured" role="cell">
                <strong>{policy.insuredName}</strong>
                <small>{policy.transactionType} / {policy.policyTypeName}</small>
              </span>
              <span data-label="Policy" role="cell">
                <strong>{policy.policyNumber}</strong>
                <small>{policy.effectiveDate}</small>
              </span>
              <span data-label="Revenue" role="cell">{formatMoneyExact(policy.agencyRevenue)}</span>
              <span data-label="Commission" role="cell">{formatMoneyExact(policy.commissionAmount)}</span>
              <span data-label="Broker fee" role="cell">{formatMoneyExact(policy.brokerFee)}</span>
              <span data-label={sheet.ownerType === "sophia" ? "Sophia share" : "Producer payout"} role="cell">
                {formatMoneyExact(
                  sheet.ownerType === "sophia"
                    ? policy.sophiaShare
                    : (policy.producerPayout ?? "0.00"),
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AdjustmentTable({
  onOpen,
  pending,
  sheet,
}: {
  onOpen(dialog: PaySheetAdjustmentDialogState): void;
  pending: boolean;
  sheet: PaySheetDetail;
}) {
  const editable = sheet.status === "open";
  return (
    <section className="pay-sheet-data-section" aria-labelledby={`adjustments-${sheet.id}`}>
      <header>
        <h3 id={`adjustments-${sheet.id}`}>Adjustments & direct income</h3>
        <span>{sheet.adjustments.length}</span>
      </header>
      {sheet.adjustments.length === 0 ? (
        <div className="pay-sheet-inline-empty">No adjustments for this period.</div>
      ) : (
        <div className="pay-sheet-adjustment-table" role="table" aria-label="Pay-sheet adjustments">
          <div className="pay-sheet-adjustment-header" role="row">
            <span role="columnheader">Entry</span>
            <span role="columnheader">Account</span>
            <span role="columnheader">Effective</span>
            <span role="columnheader">Amount</span>
            <span role="columnheader">Note</span>
            {editable ? <span role="columnheader">Actions</span> : null}
          </div>
          {sheet.adjustments.map((adjustment) => (
            <div className="pay-sheet-adjustment-row" key={adjustment.id} role="row">
              <span data-label="Entry" role="cell">
                <strong>{adjustment.insuredOrClientLabel}</strong>
                <small>{adjustmentTypeLabel(adjustment.adjustmentType)}</small>
              </span>
              <span data-label="Account" role="cell">
                {paySheetAccountLabel(
                  adjustment.accountBasis,
                  adjustment.producerDisplayName,
                )}
              </span>
              <span data-label="Effective" role="cell">{adjustment.effectiveDate}</span>
              <span data-label="Amount" role="cell">
                {adjustmentAmounts(adjustment).map(({ label, value }) => (
                  <small key={label}>{label}: <strong>{formatMoneyExact(value)}</strong></small>
                ))}
              </span>
              <span data-label="Note" role="cell">{adjustment.reasonOrNote ?? "-"}</span>
              {editable ? (
                <span className="pay-sheet-adjustment-actions" data-label="Actions" role="cell">
                  <button
                    disabled={pending}
                    onClick={() => onOpen({ adjustment, kind: "edit", sheet })}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => onOpen({ adjustment, kind: "delete", sheet })}
                    type="button"
                  >
                    Delete
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function adjustmentAmounts(
  adjustment: PaySheetAdjustmentView,
): readonly { label: string; value: string }[] {
  if (isDirectIncomeAdjustment(adjustment.adjustmentType)) {
    return [{ label: "Income", value: adjustment.incomeAmount }];
  }
  return [
    { label: "Broker", value: adjustment.brokerFeeDelta },
    { label: "Commission", value: adjustment.commissionDelta },
    { label: "Payout", value: adjustment.payoutDelta },
  ].filter(({ value }) => value !== "0.00");
}

function SheetStatus({ status }: { status: PaySheetSummary["status"] }) {
  return <span className={`pay-sheet-status is-${status}`}>{status}</span>;
}

function DetailMessage({
  action,
  body,
  busy = false,
}: {
  action?: React.ReactNode;
  body: string;
  busy?: boolean;
}) {
  return (
    <div aria-live="polite" className="pay-sheet-detail-message" role="status">
      {busy ? <span aria-hidden="true" className="pay-sheet-spinner" /> : null}
      <p>{body}</p>
      {action}
    </div>
  );
}

function PaySheetsMessage({
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
    <section className="pay-sheets-message" aria-labelledby="pay-sheets-message-title">
      {busy ? <span aria-hidden="true" className="pay-sheet-spinner" /> : null}
      <h1 id="pay-sheets-message-title">{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );
}

function historyPrimaryTotal(sheet: PaySheetSummary): string {
  if (sheet.totals === null) return "Unavailable";
  return formatMoneyExact(
    sheet.ownerType === "sophia"
      ? sheet.totals.sophiaTakeHome
      : sheet.totals.producerPayout,
  );
}

function closeBlockerLabel(value: PaySheetSummary["closeBlocker"]): string {
  if (value === "empty") return "Add a policy before close";
  if (value === "missing_rate") return "Effective rate required";
  return "Ready to close";
}

function requireAdjustmentInput(
  input: PaySheetAdjustmentInput | undefined,
): PaySheetAdjustmentInput {
  if (input === undefined) throw new PaySheetsApiError("rejected");
  return input;
}

function adjustmentDialogKey(
  dialog: PaySheetAdjustmentDialogState | null,
): string {
  if (dialog === null) return "closed";
  if (dialog.kind === "create") {
    return `${dialog.kind}:${dialog.mode}:${dialog.sheet.id}`;
  }
  return `${dialog.kind}:${dialog.adjustment.id}:${dialog.adjustment.updatedAt}`;
}
