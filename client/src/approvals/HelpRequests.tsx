import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalWorkListResponse } from "../../../shared/approval-queue.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { UpdateDraftRequest } from "../../../shared/drafts.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { useVocabulary } from "../vocabulary/context.js";
import { ApprovalDialogs, type ApprovalDialog } from "./ApprovalDialogs.js";
import { ApprovalApiError, createApprovalApi } from "./api.js";
import { isApprovalAdmin, reviewSourceValue } from "./review-state.js";

type HelpRequest = ApprovalWorkListResponse["helpRequests"][number];
type HelpDialog = Extract<ApprovalDialog, { item: HelpRequest }>;

export type HelpRequestsState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { items: HelpRequest[]; status: "ready" };

export function HelpRequests({ user }: { user: CurrentUser }) {
  return isApprovalAdmin(user) ? (
    <AdminHelpRequests />
  ) : (
    <HelpRequestsMessage
      body="This page is not available for your account."
      title="Help Requests unavailable"
    />
  );
}

function AdminHelpRequests() {
  const client = useApiClient();
  const api = useMemo(() => createApprovalApi(client), [client]);
  const vocabulary = useVocabulary();
  const [state, setState] = useState<HelpRequestsState>({ status: "loading" });
  const [dialog, setDialog] = useState<HelpDialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setState({ status: "loading" });
    try {
      const work = await api.list({ status: "flagged" });
      if (requestVersion.current === version) {
        setState({ items: work.helpRequests, status: "ready" });
      }
    } catch (error) {
      if (requestVersion.current !== version) return;
      setState({
        status:
          error instanceof ApprovalApiError && error.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [api]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  const clearSensitiveState = useCallback(() => {
    requestVersion.current += 1;
    pendingRef.current = false;
    setDialog(null);
    setNotice(null);
    setPending(false);
    setState({ status: "loading" });
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const resolve = useCallback(
    async (draftId: string, action: () => Promise<unknown>) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      try {
        await action();
        setState((current) =>
          current.status === "ready"
            ? {
                items: current.items.filter(({ draft }) => draft.id !== draftId),
                status: "ready",
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
        } else if (
          error instanceof ApprovalApiError &&
          error.kind === "conflict"
        ) {
          setNotice("That request changed while it was open. The list has been refreshed.");
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

  const mgaNames = useMemo(
    () =>
      vocabulary.state.status === "ready"
        ? new Map(vocabulary.state.data.mgas.map(({ id, name }) => [id, name]))
        : new Map<string, string>(),
    [vocabulary.state],
  );

  return (
    <>
      <HelpRequestsView
        mgaNames={mgaNames}
        notice={notice}
        onOpen={setDialog}
        onRetry={() => void load()}
        pending={pending}
        state={state}
      />
      <ApprovalDialogs
        dialog={dialog}
        key={dialog === null ? "closed" : `${dialog.kind}:${dialog.item.draft.id}`}
        onApprove={() => {}}
        onBulkApprove={() => {}}
        onCancel={() => {
          if (!pending) setDialog(null);
        }}
        onOpenFix={(draftId, input: UpdateDraftRequest) =>
          void resolve(draftId, () => api.openFixHelp(draftId, input))
        }
        onOverride={() => {}}
        onPushThrough={(draftId) =>
          void resolve(draftId, () => api.pushThroughHelp(draftId))
        }
        onSendBack={(_kind, draftId, reason) =>
          void resolve(draftId, () => api.sendBackHelp(draftId, { reason }))
        }
        pending={pending}
      />
    </>
  );
}

export function HelpRequestsView({
  mgaNames,
  notice,
  now = new Date(),
  onOpen,
  onRetry,
  pending,
  state,
}: {
  mgaNames: ReadonlyMap<string, string>;
  notice: string | null;
  now?: Date;
  onOpen(dialog: HelpDialog): void;
  onRetry(): void;
  pending: boolean;
  state: HelpRequestsState;
}) {
  if (state.status === "loading") {
    return <HelpRequestsMessage body="Retrieving flagged turn-ins..." busy title="Loading Help Requests" />;
  }
  if (state.status === "error") {
    return (
      <HelpRequestsMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="Help Requests could not be loaded."
        title="Help Requests unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <HelpRequestsMessage
        body="This page is not available for your account."
        title="Help Requests unavailable"
      />
    );
  }

  return (
    <section className="help-requests-page" aria-labelledby="help-requests-title">
      <header className="approval-page-header">
        <div>
          <p>Flagged turn-ins</p>
          <h1 id="help-requests-title">Help Requests</h1>
        </div>
        <div className="approval-count" aria-label={`${state.items.length} open help requests`}>
          <strong>{state.items.length}</strong>
          <span>Open</span>
        </div>
      </header>

      {notice === null ? null : <div className="approval-notice" role="status">{notice}</div>}
      {state.items.length === 0 ? (
        <div className="approval-empty">
          <h2>No open help requests</h2>
          <p>Flagged turn-ins will appear here.</p>
        </div>
      ) : (
        <div className="help-request-list">
          {state.items.map((item) => (
            <HelpRequestCard
              item={item}
              key={item.draft.id}
              mgaNames={mgaNames}
              now={now}
              onOpen={onOpen}
              pending={pending}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HelpRequestCard({
  item,
  mgaNames,
  now,
  onOpen,
  pending,
}: {
  item: HelpRequest;
  mgaNames: ReadonlyMap<string, string>;
  now: Date;
  onOpen(dialog: HelpDialog): void;
  pending: boolean;
}) {
  const draft = item.draft;
  const source = draft as unknown as Record<string, unknown>;
  const mga = draft.mgaId === null ? "Not set" : mgaNames.get(draft.mgaId) ?? draft.mgaId;
  return (
    <article className="help-request-card">
      <header>
        <div>
          <strong>{draft.insuredName ?? "Unnamed insured"}</strong>
          <span>{draft.policyNumber ?? "Policy pending"}</span>
        </div>
        <div className="help-request-owner">
          <strong>{item.submitterDisplayName ?? "Unknown owner"}</strong>
          <span>{formatHelpRequestAge(draft.lastEditedAt, now)}</span>
        </div>
      </header>
      <div className="approval-help-reason">
        <strong>Reason</strong>
        <p>{draft.flagReason ?? "No reason recorded"}</p>
      </div>
      <dl className="help-request-context">
        <div><dt>MGA</dt><dd>{mga}</dd></div>
        <div><dt>Base premium</dt><dd>{reviewSourceValue(source, { key: "basePremium", label: "Base", money: true })}</dd></div>
        <div><dt>Collected</dt><dd>{reviewSourceValue(source, { key: "amountPaid", label: "Collected", money: true })}</dd></div>
        <div><dt>Broker fee</dt><dd>{reviewSourceValue(source, { key: "brokerFee", label: "Broker fee", money: true })}</dd></div>
        <div><dt>Net due</dt><dd>{reviewSourceValue(source, { key: "netDue", label: "Net due", money: true })}</dd></div>
      </dl>
      <div className="approval-row-actions">
        <button disabled={pending} onClick={() => onOpen({ item, kind: "open_fix" })} type="button">Open &amp; fix</button>
        <button className="is-primary" disabled={pending} onClick={() => onOpen({ item, kind: "push_through" })} type="button">Push through</button>
        <button className="is-danger" disabled={pending} onClick={() => onOpen({ item, kind: "send_back_help" })} type="button">Send back</button>
      </div>
    </article>
  );
}

export function formatHelpRequestAge(value: string, now = new Date()): string {
  const elapsed = Math.max(0, now.getTime() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return minutes <= 1 ? "Just now" : `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

function HelpRequestsMessage({ action, body, busy = false, title }: {
  action?: React.ReactNode;
  body: string;
  busy?: boolean;
  title: string;
}) {
  return (
    <section className="approval-message" aria-busy={busy} aria-labelledby="help-requests-message-title">
      <h1 id="help-requests-message-title">{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );
}
