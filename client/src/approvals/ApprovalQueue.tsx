import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  ApprovalWorkListResponse,
  ListApprovalWorkQuery,
} from "../../../shared/approval-queue.js";
import type { UpdateDraftRequest } from "../../../shared/drafts.js";
import type { ApproveWithOverrideRequest } from "../../../shared/policy-overrides.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { useVocabulary } from "../vocabulary/context.js";
import { ApprovalApiError, createApprovalApi } from "./api.js";
import {
  ApprovalDialogs,
  type ApprovalDialog,
} from "./ApprovalDialogs.js";
import {
  APPROVAL_REVIEW_GROUPS,
  isApprovalAdmin,
  removeResolvedApprovalWork,
  reviewSourceValue,
  type ApprovalResolutionTarget,
  type ApprovalValueLookups,
} from "./review-state.js";

type ApprovalFilter = ListApprovalWorkQuery["status"];
type Submission = ApprovalWorkListResponse["submissions"][number];
type HelpRequest = ApprovalWorkListResponse["helpRequests"][number];

export type ApprovalQueueState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { status: "ready"; work: ApprovalWorkListResponse };

export function ApprovalQueue({ user }: { user: CurrentUser }) {
  return isApprovalAdmin(user) ? (
    <AdminApprovalQueue />
  ) : (
    <ApprovalMessage
      body="This page is not available for your account."
      title="Approvals unavailable"
    />
  );
}

function AdminApprovalQueue() {
  const client = useApiClient();
  const api = useMemo(() => createApprovalApi(client), [client]);
  const vocabulary = useVocabulary();
  const [filter, setFilter] = useState<ApprovalFilter>("all");
  const [state, setState] = useState<ApprovalQueueState>({ status: "loading" });
  const [dialog, setDialog] = useState<ApprovalDialog | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setState({ status: "loading" });
    try {
      const work = await api.list({ status: filter });
      if (requestVersion.current === version) {
        setState({ status: "ready", work });
      }
    } catch (error) {
      if (requestVersion.current !== version) {
        return;
      }
      setState({
        status:
          error instanceof ApprovalApiError && error.kind === "denied"
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
    setNotice(null);
    pendingRef.current = false;
    setPending(false);
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const resolve = useCallback(
    async (
      target: ApprovalResolutionTarget,
      action: () => Promise<unknown>,
    ) => {
      if (pendingRef.current) {
        return;
      }
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      try {
        await action();
        setState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                work: removeResolvedApprovalWork(current.work, target),
              }
            : current,
        );
        setDialog(null);
        await load();
      } catch (error) {
        setDialog(null);
        if (error instanceof ApprovalApiError && error.kind === "denied") {
          requestVersion.current += 1;
          setState({ status: "denied" });
          setNotice(null);
        } else if (
          error instanceof ApprovalApiError &&
          error.kind === "conflict"
        ) {
          setNotice("That item changed while it was open. The queue has been refreshed.");
          await load();
        } else if (
          error instanceof ApprovalApiError &&
          error.kind === "rejected"
        ) {
          setNotice("The action was rejected. Review the values and try again.");
        } else {
          setNotice("The action could not be completed. Try again.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [load],
  );

  const lookups = useMemo<ApprovalValueLookups>(() => {
    if (vocabulary.state.status !== "ready") {
      return {};
    }
    return {
      carriers: toNameMap(vocabulary.state.data.carriers),
      mgas: toNameMap(vocabulary.state.data.mgas),
      offices: toNameMap(vocabulary.state.data.officeLocations),
      policyTypes: toNameMap(vocabulary.state.data.policyTypes),
    };
  }, [vocabulary.state]);

  const cancelDialog = useCallback(() => {
    if (!pending) {
      setDialog(null);
    }
  }, [pending]);

  return (
    <>
      <ApprovalQueueView
        filter={filter}
        lookups={lookups}
        notice={notice}
        onFilter={(next) => {
          setDialog(null);
          setNotice(null);
          setFilter(next);
        }}
        onOpen={setDialog}
        onRetry={() => void load()}
        pending={pending}
        state={state}
      />
      <ApprovalDialogs
        dialog={dialog}
        key={dialogKey(dialog)}
        onApprove={(queueEntryId) =>
          void resolve(
            { id: queueEntryId, kind: "submission" },
            () => api.approve(queueEntryId),
          )
        }
        onCancel={cancelDialog}
        onOpenFix={(draftId, input: UpdateDraftRequest) =>
          void resolve(
            { id: draftId, kind: "help" },
            () => api.openFixHelp(draftId, input),
          )
        }
        onOverride={(queueEntryId, input: ApproveWithOverrideRequest) =>
          void resolve(
            { id: queueEntryId, kind: "submission" },
            () => api.approveWithOverride(queueEntryId, input),
          )
        }
        onPushThrough={(draftId) =>
          void resolve(
            { id: draftId, kind: "help" },
            () => api.pushThroughHelp(draftId),
          )
        }
        onSendBack={(kind, id, reason) =>
          void resolve(
            { id, kind },
            () =>
              kind === "help"
                ? api.sendBackHelp(id, { reason })
                : api.sendBackSubmission(id, { reason }),
          )
        }
        pending={pending}
      />
    </>
  );
}

export function ApprovalQueueView({
  filter,
  lookups,
  notice,
  onFilter,
  onOpen,
  onRetry,
  pending,
  state,
}: {
  filter: ApprovalFilter;
  lookups: ApprovalValueLookups;
  notice: string | null;
  onFilter(filter: ApprovalFilter): void;
  onOpen(dialog: ApprovalDialog): void;
  onRetry(): void;
  pending: boolean;
  state: ApprovalQueueState;
}) {
  if (state.status === "loading") {
    return (
      <ApprovalMessage
        body="Retrieving submitted policies and help requests..."
        busy
        title="Loading approvals"
      />
    );
  }
  if (state.status === "error") {
    return (
      <ApprovalMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="The approval queue could not be loaded."
        title="Approvals unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <ApprovalMessage
        body="This page is not available for your account."
        title="Approvals unavailable"
      />
    );
  }

  const total = state.work.submissions.length + state.work.helpRequests.length;
  return (
    <section className="approval-page" aria-labelledby="approval-page-title">
      <header className="approval-page-header">
        <div>
          <p>Policy review</p>
          <h1 id="approval-page-title">Approvals</h1>
        </div>
        <div className="approval-count" aria-label={`${total} open items`}>
          <strong>{total}</strong>
          <span>Open</span>
        </div>
      </header>

      <div className="approval-toolbar" aria-label="Approval queue filter">
        {(["all", "pending", "flagged"] as const).map((value) => (
          <button
            aria-pressed={filter === value}
            disabled={pending}
            key={value}
            onClick={() => onFilter(value)}
            type="button"
          >
            {value === "all" ? "All" : value === "pending" ? "Pending" : "Help requests"}
          </button>
        ))}
      </div>

      {notice === null ? null : (
        <div className="approval-notice" role="status">{notice}</div>
      )}

      {total === 0 ? (
        <div className="approval-empty">
          <h2>Queue clear</h2>
          <p>No items match this view.</p>
        </div>
      ) : (
        <div className="approval-work-list">
          {state.work.submissions.length === 0 ? null : (
            <section aria-labelledby="pending-approvals-title">
              <div className="approval-section-heading">
                <h2 id="pending-approvals-title">Pending submissions</h2>
                <span>{state.work.submissions.length}</span>
              </div>
              {state.work.submissions.map((item) => (
                <SubmissionReview
                  item={item}
                  key={item.entry.id}
                  lookups={lookups}
                  onOpen={onOpen}
                  pending={pending}
                />
              ))}
            </section>
          )}

          {state.work.helpRequests.length === 0 ? null : (
            <section aria-labelledby="help-approvals-title">
              <div className="approval-section-heading">
                <h2 id="help-approvals-title">Help requests</h2>
                <span>{state.work.helpRequests.length}</span>
              </div>
              {state.work.helpRequests.map((item) => (
                <HelpReview
                  item={item}
                  key={item.draft.id}
                  lookups={lookups}
                  onOpen={onOpen}
                  pending={pending}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function SubmissionReview({
  item,
  lookups,
  onOpen,
  pending,
}: {
  item: Submission;
  lookups: ApprovalValueLookups;
  onOpen(dialog: ApprovalDialog): void;
  pending: boolean;
}) {
  const source = item.entry.submittedPayload;
  return (
    <details className="approval-review-row">
      <summary>
        <span className="approval-status is-pending">Pending</span>
        <span className="approval-review-primary">
          <strong>{String(source.insuredName ?? "Unnamed insured")}</strong>
          <span>{item.submitterDisplayName ?? "Unknown submitter"}</span>
        </span>
        <span className="approval-review-policy">
          <strong>{String(source.policyNumber ?? "Policy pending")}</strong>
          <span>{String(source.transactionType ?? "Transaction pending")}</span>
        </span>
        <span className="approval-review-amount">
          {reviewSourceValue(source, { key: "netDue", label: "Net due", money: true })}
        </span>
        <span className="approval-review-time">{formatTimestamp(item.entry.submittedAt)}</span>
      </summary>
      <div className="approval-review-body">
        <ReviewFields lookups={lookups} source={source} />
        <div className="approval-row-actions">
          <button disabled={pending} onClick={() => onOpen({ item, kind: "approve" })} type="button">Approve</button>
          <button className="is-override" disabled={pending} onClick={() => onOpen({ item, kind: "override" })} type="button">Approve with override</button>
          <button className="is-danger" disabled={pending} onClick={() => onOpen({ item, kind: "send_back_submission" })} type="button">Send back</button>
        </div>
      </div>
    </details>
  );
}

function HelpReview({
  item,
  lookups,
  onOpen,
  pending,
}: {
  item: HelpRequest;
  lookups: ApprovalValueLookups;
  onOpen(dialog: ApprovalDialog): void;
  pending: boolean;
}) {
  const source = item.draft as unknown as Record<string, unknown>;
  return (
    <details className="approval-review-row is-help">
      <summary>
        <span className="approval-status is-flagged">Help</span>
        <span className="approval-review-primary">
          <strong>{item.draft.insuredName ?? "Unnamed insured"}</strong>
          <span>{item.submitterDisplayName ?? "Unknown submitter"}</span>
        </span>
        <span className="approval-review-policy">
          <strong>{item.draft.policyNumber ?? "Policy pending"}</strong>
          <span>{item.draft.transactionType ?? "Transaction pending"}</span>
        </span>
        <span className="approval-review-amount">
          {reviewSourceValue(source, { key: "netDue", label: "Net due", money: true })}
        </span>
        <span className="approval-review-time">{formatTimestamp(item.draft.lastEditedAt)}</span>
      </summary>
      <div className="approval-review-body">
        <div className="approval-help-reason">
          <strong>Help requested</strong>
          <p>{item.draft.flagReason ?? "No reason recorded"}</p>
        </div>
        <ReviewFields lookups={lookups} source={source} />
        <div className="approval-row-actions">
          <button disabled={pending} onClick={() => onOpen({ item, kind: "open_fix" })} type="button">Open &amp; fix</button>
          <button className="is-primary" disabled={pending} onClick={() => onOpen({ item, kind: "push_through" })} type="button">Push through as-is</button>
          <button className="is-danger" disabled={pending} onClick={() => onOpen({ item, kind: "send_back_help" })} type="button">Send back</button>
        </div>
      </div>
    </details>
  );
}

function ReviewFields({
  lookups,
  source,
}: {
  lookups: ApprovalValueLookups;
  source: Readonly<Record<string, unknown>>;
}) {
  return (
    <div className="approval-field-groups">
      {APPROVAL_REVIEW_GROUPS.map((group) => (
        <section key={group.title}>
          <h3>{group.title}</h3>
          <dl>
            {group.fields.map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{reviewSourceValue(source, field, lookups)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function ApprovalMessage({
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
    <section className="approval-message" aria-busy={busy} aria-labelledby="approval-message-title">
      <h1 id="approval-message-title">{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );
}

function toNameMap(items: readonly { id: string; name: string }[]) {
  return new Map(items.map(({ id, name }) => [id, name]));
}

function dialogKey(dialog: ApprovalDialog | null): string {
  if (dialog === null) return "closed";
  return `${dialog.kind}:${"entry" in dialog.item ? dialog.item.entry.id : dialog.item.draft.id}`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
