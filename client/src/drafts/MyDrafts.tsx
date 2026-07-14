import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftResponse } from "../../../shared/drafts.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { CheckTurnInForm } from "./CheckTurnInForm.js";
import { createDraftApi } from "./api.js";
import {
  draftActionLabel,
  draftStatusLabel,
  replaceProjectedDraft,
  resolveDraftSelection,
  sortOwnDrafts,
} from "./my-drafts-state.js";

export type MyDraftsState =
  | { status: "error" }
  | { status: "loading" }
  | { drafts: readonly DraftResponse[]; status: "ready" };

export type DraftWithdrawalState =
  | { draftId: string; status: "error" }
  | { draftId: string; status: "loading" }
  | null;

export function MyDrafts({
  currentPath,
  user,
}: {
  currentPath: string;
  user: CurrentUser;
}) {
  const client = useApiClient();
  const api = useMemo(() => createDraftApi(client), [client]);
  const [state, setState] = useState<MyDraftsState>({ status: "loading" });
  const [withdrawal, setWithdrawal] = useState<DraftWithdrawalState>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setState({ status: "loading" });
    try {
      const response = await api.list();
      if (requestVersion.current === version) {
        setState({ drafts: sortOwnDrafts(response.drafts), status: "ready" });
      }
    } catch {
      if (requestVersion.current === version) {
        setState({ status: "error" });
      }
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
    setState({ status: "loading" });
    setWithdrawal(null);
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const acceptProjection = useCallback((draft: DraftResponse) => {
    setState((current) =>
      current.status === "ready"
        ? {
            drafts: replaceProjectedDraft(current.drafts, draft),
            status: "ready",
          }
        : current,
    );
  }, []);

  const withdrawFlagged = useCallback(async (draftId: string) => {
    setWithdrawal({ draftId, status: "loading" });
    try {
      const response = await api.withdrawHelp(draftId);
      acceptProjection(response.draft);
      setWithdrawal(null);
      window.location.hash = `#/my-drafts?draft=${encodeURIComponent(draftId)}`;
    } catch {
      setWithdrawal({ draftId, status: "error" });
    }
  }, [acceptProjection, api]);

  return (
    <MyDraftsView
      currentPath={currentPath}
      onDraftChange={acceptProjection}
      onRetry={() => void load()}
      onWithdrawFlagged={(draftId) => void withdrawFlagged(draftId)}
      state={state}
      user={user}
      withdrawal={withdrawal}
    />
  );
}

export function MyDraftsView({
  currentPath,
  onDraftChange,
  onRetry,
  onWithdrawFlagged,
  state,
  user,
  withdrawal,
}: {
  currentPath: string;
  onDraftChange(draft: DraftResponse): void;
  onRetry(): void;
  onWithdrawFlagged(draftId: string): void;
  state: MyDraftsState;
  user: CurrentUser;
  withdrawal: DraftWithdrawalState;
}) {
  if (state.status === "loading") {
    return <DraftsMessage title="Loading drafts" body="Retrieving your latest turn-ins..." busy />;
  }
  if (state.status === "error") {
    return (
      <DraftsMessage
        title="Drafts unavailable"
        body="Your drafts could not be loaded. Check your connection and try again."
        action={<button onClick={onRetry} type="button">Try again</button>}
      />
    );
  }

  const selection = resolveDraftSelection(currentPath);
  if (selection.status !== "list") {
    const selected =
      selection.status === "selected"
        ? state.drafts.find(({ id }) => id === selection.draftId)
        : undefined;
    if (selected === undefined) {
      return (
        <DraftsMessage
          title="Draft not available"
          body="This draft is unavailable or is not part of your account."
          action={<a href="#/my-drafts">Back to My Drafts</a>}
        />
      );
    }
    if (selected.status === "draft" || selected.status === "sent_back") {
      return (
        <div className="my-drafts-editor">
          <a className="my-drafts-back" href="#/my-drafts">Back to My Drafts</a>
          <CheckTurnInForm
            initialDraft={selected}
            onDraftChange={onDraftChange}
            user={user}
          />
        </div>
      );
    }
    return (
      <DraftStatusView
        draft={selected}
        onWithdrawFlagged={onWithdrawFlagged}
        withdrawal={withdrawal}
      />
    );
  }

  return (
    <DraftList
      drafts={state.drafts}
      onWithdrawFlagged={onWithdrawFlagged}
      withdrawal={withdrawal}
    />
  );
}

function DraftList({
  drafts,
  onWithdrawFlagged,
  withdrawal,
}: {
  drafts: readonly DraftResponse[];
  onWithdrawFlagged(draftId: string): void;
  withdrawal: DraftWithdrawalState;
}) {
  return (
    <section className="my-drafts-page" aria-labelledby="my-drafts-title">
      <header className="my-drafts-header">
        <div>
          <p>Policy intake</p>
          <h1 id="my-drafts-title">My Drafts</h1>
        </div>
        <a className="my-drafts-new" href="#/turn-in">New turn-in</a>
      </header>

      {drafts.length === 0 ? (
        <div className="my-drafts-empty">
          <h2>No turn-ins yet</h2>
          <p>Saved drafts and submitted turn-ins will appear here.</p>
          <a href="#/turn-in">Start a turn-in</a>
        </div>
      ) : (
        <div className="my-drafts-table-wrap">
          <table className="my-drafts-table">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Insured</th>
                <th scope="col">Policy</th>
                <th scope="col">Last activity</th>
                <th scope="col"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr key={draft.id}>
                  <td data-label="Status">
                    <span className={`draft-status is-${draft.status}`}>
                      {draftStatusLabel(draft.status)}
                    </span>
                  </td>
                  <td data-label="Insured">
                    <strong>{draft.insuredName ?? "Unnamed insured"}</strong>
                    {draft.companyName === null ? null : <span>{draft.companyName}</span>}
                  </td>
                  <td data-label="Policy">
                    <strong>{draft.policyNumber ?? "Policy number pending"}</strong>
                    <span>{draft.transactionType ?? "Transaction pending"}</span>
                  </td>
                  <td data-label="Last activity">
                    <time dateTime={draft.lastEditedAt}>{formatTimestamp(draft.lastEditedAt)}</time>
                  </td>
                  <td className="my-drafts-action">
                    {draft.status === "flagged" ? (
                      <>
                        <button
                          disabled={withdrawal?.draftId === draft.id && withdrawal.status === "loading"}
                          onClick={() => onWithdrawFlagged(draft.id)}
                          type="button"
                        >
                          {withdrawal?.draftId === draft.id && withdrawal.status === "loading"
                            ? "Reopening..."
                            : draftActionLabel(draft.status)}
                        </button>
                        {withdrawal?.draftId === draft.id && withdrawal.status === "error" ? (
                          <span className="my-drafts-action-error" role="alert">
                            Could not reopen. Refresh and try again.
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <a href={`#/my-drafts?draft=${encodeURIComponent(draft.id)}`}>
                        {draftActionLabel(draft.status)}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DraftStatusView({
  draft,
  onWithdrawFlagged,
  withdrawal,
}: {
  draft: DraftResponse;
  onWithdrawFlagged(draftId: string): void;
  withdrawal: DraftWithdrawalState;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  return (
    <section className="draft-status-view" aria-labelledby="draft-status-title">
      <a className="my-drafts-back" href="#/my-drafts">Back to My Drafts</a>
      <header>
        <span className={`draft-status is-${draft.status}`}>
          {draftStatusLabel(draft.status)}
        </span>
        <h1 id="draft-status-title" ref={headingRef} tabIndex={-1}>
          {draft.insuredName ?? "Unnamed insured"}
        </h1>
        <p>{statusSummary(draft.status)}</p>
      </header>
      <dl>
        <div><dt>Policy number</dt><dd>{draft.policyNumber ?? "Pending"}</dd></div>
        <div><dt>Transaction</dt><dd>{draft.transactionType ?? "Pending"}</dd></div>
        <div><dt>Last activity</dt><dd><time dateTime={draft.lastEditedAt}>{formatTimestamp(draft.lastEditedAt)}</time></dd></div>
        {draft.submittedAt === null ? null : (
          <div><dt>Submitted</dt><dd><time dateTime={draft.submittedAt}>{formatTimestamp(draft.submittedAt)}</time></dd></div>
        )}
      </dl>
      {draft.status === "flagged" && draft.flagReason !== null ? (
        <div className="draft-status-note"><strong>Help requested</strong><p>{draft.flagReason}</p></div>
      ) : null}
      {draft.status === "flagged" ? (
        <div className="draft-status-actions">
          <button
            disabled={withdrawal?.draftId === draft.id && withdrawal.status === "loading"}
            onClick={() => onWithdrawFlagged(draft.id)}
            type="button"
          >
            {withdrawal?.draftId === draft.id && withdrawal.status === "loading"
              ? "Reopening..."
              : "Reopen and edit"}
          </button>
          {withdrawal?.draftId === draft.id && withdrawal.status === "error" ? (
            <p role="alert">Could not reopen this draft. Refresh and try again.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DraftsMessage({
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
    <section className="my-drafts-message" aria-busy={busy} aria-labelledby="my-drafts-message-title">
      <h1 id="my-drafts-message-title">{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );
}

function statusSummary(status: DraftResponse["status"]): string {
  switch (status) {
    case "submitted":
      return "This turn-in is waiting for admin review.";
    case "flagged":
      return "This turn-in is visible to the admin help queue.";
    case "approved":
      return "This turn-in has moved to the policy ledger.";
    case "draft":
      return "This turn-in is ready to edit.";
    case "sent_back":
      return "This turn-in needs changes before it can be resubmitted.";
  }
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
