import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  MAX_MGA_PAYMENT_REFERENCE_LENGTH,
  MGA_PAYABLE_FILTERS,
  type MgaPayableFilter,
  type MgaPayableItem,
  type MgaPayableListResponse,
} from "../../../shared/mga-payables.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { EmptyState } from "../ui/EmptyState.js";
import { PageHeader } from "../ui/PageHeader.js";
import {
  ActionFeedback,
  CONFIRMATION_FEEDBACK_MS,
  REVERSIBLE_ACTION_WINDOW_MS,
  type ActionFeedbackState,
} from "../ui/ActionFeedback.js";
import {
  formatAbsoluteTimestamp,
  formatRelativeTime,
} from "../ui/time.js";
import { formatMoneyExact } from "../ledger/view-state.js";
import {
  createMgaPayablesApi,
  MgaPayablesApiError,
} from "./api.js";
import {
  formatPayableCommissionRate,
  isMgaPayablesAdmin,
  oldestOutstandingDays,
  outstandingShare,
  payableAccountLabel,
  payableAging,
  payableGroupAction,
} from "./view-state.js";

export type MgaPayablesState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { data: MgaPayableListResponse; status: "ready" };

export interface MgaPaymentDialog {
  item: MgaPayableItem;
  targetStatus: "paid" | "unpaid";
}

export function MgaPayables({ user }: { user: CurrentUser }) {
  return isMgaPayablesAdmin(user) ? (
    <AdminMgaPayables />
  ) : (
    <PayablesMessage
      body="This page is not available for your account."
      title="MGA payables unavailable"
    />
  );
}

function AdminMgaPayables() {
  const client = useApiClient();
  const api = useMemo(() => createMgaPayablesApi(client), [client]);
  const [filter, setFilter] = useState<MgaPayableFilter>("unpaid");
  const [state, setState] = useState<MgaPayablesState>({ status: "loading" });
  const [dialog, setDialog] = useState<MgaPaymentDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedbackState | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingPolicyId, setPendingPolicyId] = useState<string | null>(null);
  const [departingPolicyId, setDepartingPolicyId] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const pendingRef = useRef(false);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setState({ status: "loading" });
    try {
      const data = await api.list(filter);
      if (requestVersion.current === version) {
        setState({ data, status: "ready" });
      }
    } catch (error) {
      if (requestVersion.current !== version) return;
      setState({
        status:
          error instanceof MgaPayablesApiError && error.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [api, filter]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  const clearSensitiveState = useCallback(() => {
    requestVersion.current += 1;
    setState({ status: "loading" });
    setDialog(null);
    setDialogError(null);
    setNotice(null);
    setFeedback(null);
    setPendingPolicyId(null);
    setDepartingPolicyId(null);
    pendingRef.current = false;
    setPending(false);
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const undoPayment: (item: MgaPayableItem) => Promise<void> = useCallback(
    async (item: MgaPayableItem) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setPendingPolicyId(item.policyId);
      setFeedback(null);
      try {
        await api.change(item.policyId, {
          reference: item.status === "paid" ? item.paymentReference : null,
          status: item.status,
        });
        setFeedback({
          kind: "success",
          message: `MGA payment restored to ${item.status}.`,
        });
        await load();
      } catch (error) {
        setFeedback({
          actionLabel: "Retry",
          kind: "error",
          message:
            error instanceof MgaPayablesApiError && error.kind === "conflict"
              ? "That payable changed before Undo could finish. Refresh and review it."
              : "Undo could not be completed. The payment remains in its current state.",
          onAction: () => void undoPayment(item),
        });
      } finally {
        pendingRef.current = false;
        setPendingPolicyId(null);
        setPending(false);
      }
    },
    [api, load],
  );

  const submit = useCallback(
    async (reference: string | null) => {
      if (dialog === null || pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setPendingPolicyId(dialog.item.policyId);
      setDialogError(null);
      setNotice(null);
      setFeedback(null);
      const previousItem = dialog.item;
      try {
        await api.change(dialog.item.policyId, {
          reference:
            dialog.targetStatus === "paid" ? reference : null,
          status: dialog.targetStatus,
        });
        setDialog(null);
        setDepartingPolicyId(dialog.item.policyId);
        setFeedback({
          actionLabel: "Undo",
          kind: "success",
          message:
            dialog.targetStatus === "paid"
              ? "MGA payment marked paid."
              : "MGA payment marked unpaid.",
          onAction: () => void undoPayment(previousItem),
        });
        await waitForRowDeparture();
        await load();
      } catch (error) {
        if (error instanceof MgaPayablesApiError && error.kind === "denied") {
          requestVersion.current += 1;
          setState({ status: "denied" });
          setDialog(null);
          setNotice(null);
        } else if (
          error instanceof MgaPayablesApiError &&
          error.kind === "conflict"
        ) {
          setDialog(null);
          setNotice("That payable changed. The server view has been refreshed.");
          await load();
        } else if (
          error instanceof MgaPayablesApiError &&
          error.kind === "rejected"
        ) {
          setDialogError("The payment change was rejected. Review the reference and try again.");
        } else {
          setDialogError("The payment change could not be completed. Try again.");
        }
      } finally {
        setDepartingPolicyId(null);
        setPendingPolicyId(null);
        pendingRef.current = false;
        setPending(false);
      }
    },
    [api, dialog, load, undoPayment],
  );

  const changeGroup = useCallback(
    async (
      mgaId: string,
      mgaName: string,
      count: number,
      status: "paid" | "unpaid",
    ) => {
      if (pendingRef.current) return;
      if (
        status === "unpaid" &&
        !window.confirm(
          `Mark all ${count} policies in ${mgaName} unpaid? Open pay-sheet placements will be removed; closed history stays unchanged.`,
        )
      ) {
        return;
      }
      pendingRef.current = true;
      setPending(true);
      setDialog(null);
      setDialogError(null);
      setNotice(null);
      try {
        const changed = await api.changeGroup(mgaId, { status });
        setNotice(
          changed.changedCount === 0
            ? "That MGA group was already up to date."
            : `${changed.changedCount} MGA ${changed.changedCount === 1 ? "payment" : "payments"} marked ${status}.`,
        );
        await load();
      } catch (error) {
        if (error instanceof MgaPayablesApiError && error.kind === "denied") {
          requestVersion.current += 1;
          setState({ status: "denied" });
        } else if (
          error instanceof MgaPayablesApiError &&
          error.kind === "conflict"
        ) {
          setNotice("That MGA group changed. The server view has been refreshed.");
          await load();
        } else {
          setNotice("The MGA group could not be changed. No payments were updated.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [api, load],
  );

  return (
    <>
      <MgaPayablesView
        filter={filter}
        notice={notice}
        departingPolicyId={departingPolicyId}
        onFilter={(next) => {
          if (pendingRef.current) return;
          setDialog(null);
          setDialogError(null);
          setNotice(null);
          setFilter(next);
        }}
        onGroupChange={(mgaId, mgaName, count, status) =>
          void changeGroup(mgaId, mgaName, count, status)}
        onOpen={(nextDialog) => {
          if (pendingRef.current) return;
          setDialogError(null);
          setDialog(nextDialog);
        }}
        onRetry={() => void load()}
        pending={pending}
        pendingPolicyId={pendingPolicyId}
        state={state}
      />
      <ActionFeedback
        feedback={feedback}
        onDismiss={() => setFeedback(null)}
        timeoutMs={
          feedback?.kind !== "success"
            ? undefined
            : feedback.onAction === undefined
              ? CONFIRMATION_FEEDBACK_MS
              : REVERSIBLE_ACTION_WINDOW_MS
        }
      />
      <MgaPaymentStateDialog
        dialog={dialog}
        error={dialogError}
        key={
          dialog === null
            ? "closed"
            : `${dialog.targetStatus}:${dialog.item.policyId}`
        }
        onCancel={() => {
          if (!pending) {
            setDialog(null);
            setDialogError(null);
          }
        }}
        onSubmit={(reference) => void submit(reference)}
        pending={pending}
      />
    </>
  );
}

export function MgaPayablesView({
  departingPolicyId = null,
  filter,
  notice,
  now = new Date(),
  onFilter,
  onGroupChange,
  onOpen,
  onRetry,
  pending,
  pendingPolicyId = null,
  state,
}: {
  departingPolicyId?: string | null;
  filter: MgaPayableFilter;
  notice: string | null;
  now?: Date;
  onFilter(filter: MgaPayableFilter): void;
  onGroupChange(
    mgaId: string,
    mgaName: string,
    count: number,
    status: "paid" | "unpaid",
  ): void;
  onOpen(dialog: MgaPaymentDialog): void;
  onRetry(): void;
  pending: boolean;
  pendingPolicyId?: string | null;
  state: MgaPayablesState;
}) {
  if (state.status === "loading") {
    return (
      <PayablesMessage
        body="Retrieving grouped MGA obligations..."
        busy
        title="Loading MGA payables"
      />
    );
  }
  if (state.status === "error") {
    return (
      <PayablesMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="MGA payables could not be loaded."
        title="MGA payables unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <PayablesMessage
        body="This page is not available for your account."
        title="MGA payables unavailable"
      />
    );
  }

  const { data } = state;
  return (
    <section className="mga-page" aria-labelledby="mga-page-title">
      <PageHeader
        eyebrow="Agency settlement"
        status={(
          <>
            <strong>{data.summary.unpaidCount}</strong> {data.summary.unpaidCount === 1 ? "policy remains" : "policies remain"} outstanding.
          </>
        )}
        title="MGA Payables"
        titleId="mga-page-title"
      />

      <div className="mga-summary" aria-label="MGA payable totals">
        <SummaryMetric
          label="Total outstanding"
          tone="outstanding"
          value={formatMoneyExact(data.summary.outstandingAmount)}
        />
        <SummaryMetric
          label="Paid"
          tone="paid"
          value={formatMoneyExact(data.summary.paidAmount)}
        />
        <SummaryMetric
          label="Settled"
          tone="count"
          value={`${data.summary.paidCount} / ${data.summary.totalCount}`}
        />
        <div className="mga-filter" aria-label="MGA payment status filter">
          {MGA_PAYABLE_FILTERS.map((status) => (
            <button
              aria-pressed={filter === status}
              disabled={pending}
              key={status}
              onClick={() => onFilter(status)}
              type="button"
            >
              {filterLabel(status)}
            </button>
          ))}
        </div>
      </div>

      {notice === null ? null : (
        <div className="mga-notice" role="status">{notice}</div>
      )}

      {data.groups.length === 0 ? (
        <EmptyState
          action={data.summary.totalCount === 0 ? (
            <a href="#/policy-ledger">View policy ledger</a>
          ) : (
            <button disabled={pending} onClick={() => onFilter("all")} type="button">Show all</button>
          )}
          body={data.summary.totalCount === 0
            ? "Approved policies will appear here when money is due to an MGA."
            : "There are no payables with this status."}
          className="mga-empty"
          heading={data.summary.totalCount === 0
            ? "No MGA payables yet"
            : `No ${filter === "paid" ? "paid" : filter === "unpaid" ? "unpaid" : "matching"} payables`}
        />
      ) : (
        <div className="mga-group-list">
          {data.groups.map((group) => (
            <article className="mga-group" key={group.mgaId}>
              <header className="mga-group-header">
                <div>
                  <h2>{group.mgaName}</h2>
                  <span>
                    {group.totals.paidCount === group.totals.totalCount
                      ? "Fully settled"
                      : `${group.totals.paidCount} of ${group.totals.totalCount} settled`}
                  </span>
                  <small className="mga-group-context">
                    {outstandingShare(
                      group.totals.outstandingAmount,
                      data.summary.outstandingAmount,
                    )}{" "}
                    of agency outstanding
                    {oldestOutstandingDays(group, now) === null
                      ? null
                      : ` · oldest ${oldestOutstandingDays(group, now)} days`}
                  </small>
                </div>
                <dl>
                  <div>
                    <dt>Outstanding</dt>
                    <dd>{formatMoneyExact(group.totals.outstandingAmount)}</dd>
                  </div>
                  <div>
                    <dt>Paid</dt>
                    <dd>{formatMoneyExact(group.totals.paidAmount)}</dd>
                  </div>
                </dl>
                {(() => {
                  const action = payableGroupAction(group);
                  return (
                    <button
                      className="mga-group-action"
                      disabled={pending || action.count === 0}
                      onClick={() =>
                        onGroupChange(
                          group.mgaId,
                          group.mgaName,
                          action.count,
                          action.status,
                        )}
                      type="button"
                    >
                      {action.label}
                    </button>
                  );
                })()}
              </header>
              <div className="mga-table" role="table" aria-label={`${group.mgaName} payables`}>
                <div className="mga-table-header" role="row">
                  <span role="columnheader">Insured</span>
                  <span role="columnheader">Account</span>
                  <span role="columnheader">Policy</span>
                  <span role="columnheader">Collected</span>
                  <span role="columnheader">Commission</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Net due</span>
                  <span role="columnheader">Payment reference</span>
                  <span role="columnheader">Action</span>
                </div>
                {group.items.map((item) => (
                  <PayableRow
                    item={item}
                    key={item.policyId}
                    now={now}
                    onOpen={onOpen}
                    departing={departingPolicyId === item.policyId}
                    pending={pending}
                    rowPending={pendingPolicyId === item.policyId}
                  />
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "count" | "outstanding" | "paid";
  value: string;
}) {
  return (
    <div className={`mga-summary-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PayableRow({
  departing,
  item,
  now,
  onOpen,
  pending,
  rowPending,
}: {
  departing: boolean;
  item: MgaPayableItem;
  now: Date;
  onOpen(dialog: MgaPaymentDialog): void;
  pending: boolean;
  rowPending: boolean;
}) {
  const aging = payableAging(item, now);
  return (
    <div
      aria-busy={rowPending || undefined}
      className={`mga-table-row${item.status === "paid" ? " is-paid" : ""}${
        departing ? " is-departing" : ""
      }`}
      data-keyboard-row
      role="row"
      tabIndex={0}
    >
      <span className="mga-insured" data-label="Insured" role="cell">
        <strong>{item.insuredName}</strong>
        <small>{item.policyTypeName} | {item.transactionType}</small>
        <span className="mga-badges">
          {item.overridden ? <Badge label="Override" tone="override" /> : null}
          {aging === null ? null : (
            <Badge label={aging.label} tone={aging.tone} />
          )}
        </span>
      </span>
      <span data-label="Account" role="cell">
        <strong>{payableAccountLabel(item)}</strong>
      </span>
      <span data-label="Policy" role="cell">
        <strong>{item.policyNumber}</strong>
        <small>
          Approved{" "}
          <time
            dateTime={item.approvedAt}
            title={formatAbsoluteTimestamp(item.approvedAt)}
          >
            {formatRelativeTime(item.approvedAt, now)}
          </time>
        </small>
      </span>
      <span className="mga-collected" data-label="Collected" role="cell">
        <strong>{formatMoneyExact(item.amountPaid)}</strong>
      </span>
      <span className="mga-commission" data-label="Commission" role="cell">
        <strong>
          {formatMoneyExact(item.commissionAmount)}
          {formatPayableCommissionRate(item.commissionRate) === null
            ? null
            : <small> ({formatPayableCommissionRate(item.commissionRate)})</small>}
        </strong>
        <small>+ {formatMoneyExact(item.brokerFee)} broker fee</small>
      </span>
      <span data-label="Status" role="cell">
        <Badge
          label={item.status === "paid" ? "Paid" : "Unpaid"}
          tone={item.status === "paid" ? "paid" : "unpaid"}
        />
        {item.paidAt === null ? null : (
          <small>
            <time
              dateTime={item.paidAt}
              title={formatAbsoluteTimestamp(item.paidAt)}
            >
              {formatRelativeTime(item.paidAt, now)}
            </time>
          </small>
        )}
      </span>
      <span className="mga-net" data-label="Net due" role="cell">
        <strong>{formatMoneyExact(item.netDue)}</strong>
      </span>
      <span className="mga-reference" data-label="Payment reference" role="cell">
        {item.status === "paid"
          ? (item.paymentReference ?? "No reference")
          : "Not paid"}
      </span>
      <span className="mga-row-action" role="cell">
        <button
          className={item.status === "paid" ? "is-unmark" : "is-mark"}
          data-row-primary-action
          disabled={pending}
          onClick={() =>
            onOpen({
              item,
              targetStatus: item.status === "paid" ? "unpaid" : "paid",
            })
          }
          type="button"
        >
          {rowPending
            ? "Updating..."
            : item.status === "paid"
              ? "Unmark"
              : "Mark paid"}
        </button>
      </span>
    </div>
  );
}

function waitForRowDeparture(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 160));
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "danger" | "override" | "paid" | "unpaid" | "warning";
}) {
  return <span className={`mga-badge is-${tone}`}>{label}</span>;
}

export function MgaPaymentStateDialog({
  dialog,
  error,
  onCancel,
  onSubmit,
  pending,
}: {
  dialog: MgaPaymentDialog | null;
  error: string | null;
  onCancel(): void;
  onSubmit(reference: string | null): void;
  pending: boolean;
}) {
  const [reference, setReference] = useState("");
  if (dialog === null) return null;
  const markingPaid = dialog.targetStatus === "paid";
  const title = markingPaid ? "Mark MGA payment paid" : "Mark MGA payment unpaid";
  const submitDialog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(markingPaid ? (reference.trim() || null) : null);
  };
  return (
    <div className="mga-dialog-backdrop">
      <form
        aria-labelledby="mga-dialog-title"
        aria-modal="true"
        className="mga-dialog"
        onSubmit={submitDialog}
        role="dialog"
      >
        <header>
          <div>
            <p>{dialog.item.insuredName}</p>
            <h2 id="mga-dialog-title">{title}</h2>
          </div>
          <button
            aria-label="Close"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            x
          </button>
        </header>
        {markingPaid ? (
          <label className="mga-dialog-field">
            <span>Payment reference (optional)</span>
            <input
              autoComplete="off"
              disabled={pending}
              maxLength={MAX_MGA_PAYMENT_REFERENCE_LENGTH}
              onChange={(event) => setReference(event.currentTarget.value)}
              placeholder="Check, wire, or confirmation reference"
              value={reference}
            />
          </label>
        ) : (
          <p className="mga-dialog-warning">
            Open pay-sheet placements for this policy will be removed. Closed
            pay-sheet history will remain unchanged.
          </p>
        )}
        {error === null ? null : (
          <p className="mga-dialog-error" role="alert">{error}</p>
        )}
        <footer>
          <button disabled={pending} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className={markingPaid ? "is-primary" : "is-danger"}
            disabled={pending}
            type="submit"
          >
            {pending
              ? "Saving..."
              : markingPaid
                ? "Mark paid"
                : "Confirm unmark"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function PayablesMessage({
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
    <section
      aria-busy={busy || undefined}
      className="mga-message"
      aria-labelledby="mga-message-title"
    >
      <h1 id="mga-message-title">{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );
}

function filterLabel(filter: MgaPayableFilter): string {
  if (filter === "unpaid") return "Unpaid only";
  if (filter === "paid") return "Paid only";
  return "All";
}
