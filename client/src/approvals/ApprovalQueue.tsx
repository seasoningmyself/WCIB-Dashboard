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
  ApprovalWorkListResponse,
  ListApprovalWorkQuery,
} from "../../../shared/approval-queue.js";
import type {
  DeletedApprovalWorkListResponse,
} from "../../../shared/approval-work-deletions.js";
import type { UpdateDraftRequest } from "../../../shared/drafts.js";
import type { ApproveWithOverrideRequest } from "../../../shared/policy-overrides.js";
import type { PolicyLedgerCorrectionRequest } from "../../../shared/policy-corrections.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { EmptyState } from "../ui/EmptyState.js";
import { PageHeader } from "../ui/PageHeader.js";
import {
  PolicyLedgerApiError,
  createPolicyLedgerApi,
} from "../ledger/api.js";
import { useVocabulary } from "../vocabulary/context.js";
import { ApprovalApiError, createApprovalApi } from "./api.js";
import {
  ApprovalWorkDeletionDialogView,
  DeletedApprovalWorkPanel,
  type ApprovalWorkDeletionDialog,
} from "./ApprovalWorkDeletionDialogs.js";
import {
  ApprovalDialogs,
  type ApprovalDialog,
} from "./ApprovalDialogs.js";
import {
  PolicyChangeRequestDialogs,
  type PolicyChangeRequestDialog,
} from "./PolicyChangeRequestDialogs.js";
import {
  APPROVAL_REVIEW_GROUPS,
  approvalReviewBadge,
  approveSequentially,
  groupApprovalSubmissions,
  isApprovalAdmin,
  removeResolvedApprovalWork,
  reviewSourceValue,
  type ApprovalResolutionTarget,
  type ApprovalValueLookups,
} from "./review-state.js";

type ApprovalFilter = ListApprovalWorkQuery["status"];
type Submission = ApprovalWorkListResponse["submissions"][number];
type HelpRequest = ApprovalWorkListResponse["helpRequests"][number];
type ChangeRequest = ApprovalWorkListResponse["changeRequests"][number];
type QueueDialog = ApprovalDialog | PolicyChangeRequestDialog;

interface BulkApprovalResult {
  id: string;
  name: string;
  status: "approved" | "failed";
}

export type ApprovalQueueState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | {
      deleted: DeletedApprovalWorkListResponse;
      status: "ready";
      work: ApprovalWorkListResponse;
    };

export function ApprovalQueue({ user }: { user: CurrentUser }) {
  return isApprovalAdmin(user) ? (
    <AdminApprovalQueue user={user} />
  ) : (
    <ApprovalMessage
      body="This page is not available for your account."
      title="Approvals unavailable"
    />
  );
}

function AdminApprovalQueue({ user }: { user: CurrentUser }) {
  const client = useApiClient();
  const api = useMemo(() => createApprovalApi(client), [client]);
  const ledgerApi = useMemo(() => createPolicyLedgerApi(client), [client]);
  const vocabulary = useVocabulary();
  const [filter, setFilter] = useState<ApprovalFilter>("all");
  const [state, setState] = useState<ApprovalQueueState>({ status: "loading" });
  const [dialog, setDialog] = useState<QueueDialog | null>(null);
  const [deletionDialog, setDeletionDialog] =
    useState<ApprovalWorkDeletionDialog | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkApprovalResult[]>([]);
  const [producerOptions, setProducerOptions] = useState<
    readonly DraftAssignmentOption[]
  >([]);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedSubmissionIds, setExpandedSubmissionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const pendingRef = useRef(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setState({ status: "loading" });
    setProducerOptions([]);
    try {
      const [work, deleted, assignmentOptions] = await Promise.all([
        api.list({ status: filter }),
        api.listDeleted(),
        ledgerApi.listAssignmentOptions(),
      ]);
      if (requestVersion.current === version) {
        setProducerOptions(assignmentOptions.producers);
        setState({ deleted, status: "ready", work });
        const liveIds = new Set(work.submissions.map(({ entry }) => entry.id));
        setSelectedSubmissionIds((current) =>
          new Set([...current].filter((id) => liveIds.has(id))),
        );
        setExpandedSubmissionIds((current) =>
          new Set([...current].filter((id) => liveIds.has(id))),
        );
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
  }, [api, filter, ledgerApi]);

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
    setDeletionDialog(null);
    setShowDeleted(false);
    setNotice(null);
    setBulkResults([]);
    setProducerOptions([]);
    setSelectedSubmissionIds(new Set());
    setExpandedSubmissionIds(new Set());
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
      setBulkResults([]);
      try {
        await action();
        setState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                deleted: current.deleted,
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
    const producers = new Map(
      producerOptions.map(({ displayName, userId }) => [userId, displayName]),
    );
    if (vocabulary.state.status !== "ready") {
      return { producers };
    }
    return {
      carriers: toNameMap(vocabulary.state.data.carriers),
      mgas: toNameMap(vocabulary.state.data.mgas),
      offices: toNameMap(vocabulary.state.data.officeLocations),
      policyTypes: toNameMap(vocabulary.state.data.policyTypes),
      producers,
    };
  }, [producerOptions, vocabulary.state]);

  const changeDeletion = useCallback(
    async (action: () => Promise<unknown>, successMessage: string) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      try {
        await action();
        setDeletionDialog(null);
        setNotice(successMessage);
        await load();
      } catch (error) {
        setDeletionDialog(null);
        if (error instanceof ApprovalApiError && error.kind === "denied") {
          requestVersion.current += 1;
          setState({ status: "denied" });
          setShowDeleted(false);
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
          setNotice("The deletion request was rejected.");
        } else {
          setNotice("The deletion request could not be completed. Try again.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [api, load],
  );

  const cancelDialog = useCallback(() => {
    if (!pending) {
      setDialog(null);
    }
  }, [pending]);

  const openPolicyChangeRequest = useCallback(
    async (item: ChangeRequest) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      try {
        const [detail, assignmentOptions] = await Promise.all([
          ledgerApi.get(item.request.policyId),
          ledgerApi.listAssignmentOptions(),
        ]);
        setDialog({
          assignmentOptions: assignmentOptions.producers,
          item,
          kind: "change_request_fix_choice",
          policy: detail.item,
        });
      } catch (error) {
        if (error instanceof PolicyLedgerApiError && error.kind === "denied") {
          requestVersion.current += 1;
          setState({ status: "denied" });
        } else {
          setNotice("The approved policy could not be opened. Refresh and try again.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [ledgerApi],
  );

  const openFixDialog = useCallback(
    async (
      buildDialog: (
        assignmentOptions: readonly DraftAssignmentOption[],
      ) => ApprovalDialog,
    ) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      try {
        const assignmentOptions = await ledgerApi.listAssignmentOptions();
        setDialog(buildDialog(assignmentOptions.producers));
      } catch (error) {
        if (error instanceof PolicyLedgerApiError && error.kind === "denied") {
          requestVersion.current += 1;
          setState({ status: "denied" });
        } else {
          setNotice("Assignment options could not be loaded. Refresh and try again.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [ledgerApi],
  );

  const bulkApprove = useCallback(
    async (queueEntryIds: string[]) => {
      if (pendingRef.current || state.status !== "ready") return;
      const selected = state.work.submissions.filter(({ entry }) =>
        queueEntryIds.includes(entry.id),
      );
      if (selected.length === 0) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      try {
        const names = new Map(
          selected.map(({ entry }) => [
            entry.id,
            String(entry.submittedPayload.insuredName ?? "Unnamed insured"),
          ]),
        );
        const results = await approveSequentially(
          selected.map(({ entry }) => entry.id),
          (id) => api.approve(id),
        );
        const approvedIds = new Set(
          results.filter(({ status }) => status === "approved").map(({ id }) => id),
        );
        const failedIds = new Set(
          results.filter(({ status }) => status === "failed").map(({ id }) => id),
        );
        setBulkResults(
          results.map(({ id, status }) => ({
            id,
            name: names.get(id) ?? "Unknown submission",
            status,
          })),
        );
        setSelectedSubmissionIds(failedIds);
        setExpandedSubmissionIds((current) =>
          new Set([...current].filter((id) => !approvedIds.has(id))),
        );
        setState((current) =>
          current.status === "ready"
            ? {
                ...current,
                work: {
                  ...current.work,
                  submissions: current.work.submissions.filter(
                    ({ entry }) => !approvedIds.has(entry.id),
                  ),
                },
              }
            : current,
        );
        setDialog(null);
        const approvedCount = approvedIds.size;
        const failedCount = failedIds.size;
        setNotice(
          failedCount === 0
            ? `${approvedCount} submission${approvedCount === 1 ? "" : "s"} approved.`
            : `${approvedCount} approved; ${failedCount} not approved. Review the item results below.`,
        );
        const denied = results.some(
          ({ error }) =>
            error instanceof ApprovalApiError && error.kind === "denied",
        );
        if (denied) {
          requestVersion.current += 1;
          setState({ status: "denied" });
          setBulkResults([]);
          setNotice(null);
        } else {
          await load();
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [api, load, state],
  );

  const approvalDialog = isApprovalDialog(dialog) ? dialog : null;
  const policyChangeDialog = isPolicyChangeRequestDialog(dialog) ? dialog : null;

  return (
    <>
      <ApprovalQueueView
        bulkResults={bulkResults}
        expandedSubmissionIds={expandedSubmissionIds}
        filter={filter}
        lookups={lookups}
        notice={notice}
        onFilter={(next) => {
          setDialog(null);
          setNotice(null);
          setBulkResults([]);
          setSelectedSubmissionIds(new Set());
          setExpandedSubmissionIds(new Set());
          setFilter(next);
        }}
        onApproveSelected={(items) => setDialog({ items, kind: "bulk_approve" })}
        onExpandSubmission={(id, expanded) =>
          setExpandedSubmissionIds((current) => {
            const next = new Set(current);
            expanded ? next.add(id) : next.delete(id);
            return next;
          })
        }
        onExpandSubmissions={(expanded) =>
          setExpandedSubmissionIds(
            expanded && state.status === "ready"
              ? new Set(state.work.submissions.map(({ entry }) => entry.id))
              : new Set(),
          )
        }
        onInlineApprove={(item) =>
          void resolve(
            { id: item.entry.id, kind: "submission" },
            () => api.approve(item.entry.id),
          )
        }
        onOpenHelpFix={(item) =>
          void openFixDialog((assignmentOptions) => ({
            assignmentOptions,
            item,
            kind: "open_fix",
          }))
        }
        onOpenChangeFix={(item) => void openPolicyChangeRequest(item)}
        onDeleteHelp={(item) =>
          setDeletionDialog({ item, kind: "delete_help" })
        }
        onDeleteSubmission={(item) =>
          setDeletionDialog({ item, kind: "delete_submission" })
        }
        onOpenDeleted={() => setShowDeleted(true)}
        onOpen={setDialog}
        onOpenSubmissionFix={(item) =>
          void openFixDialog((assignmentOptions) => ({
            assignmentOptions,
            item,
            kind: "edit_fix_submission",
          }))
        }
        onRetry={() => void load()}
        onSelectSubmission={(id, selected) =>
          setSelectedSubmissionIds((current) => {
            const next = new Set(current);
            selected ? next.add(id) : next.delete(id);
            return next;
          })
        }
        onSelectSubmissions={(selected) =>
          setSelectedSubmissionIds(
            selected && state.status === "ready"
              ? new Set(state.work.submissions.map(({ entry }) => entry.id))
              : new Set(),
          )
        }
        pending={pending}
        selectedSubmissionIds={selectedSubmissionIds}
        state={state}
      />
      <DeletedApprovalWorkPanel
        data={state.status === "ready" ? state.deleted : { items: [] }}
        onClose={() => {
          if (!pending) setShowDeleted(false);
        }}
        onRestore={(item) => setDeletionDialog({ item, kind: "restore" })}
        open={showDeleted}
        pending={pending}
      />
      <ApprovalWorkDeletionDialogView
        dialog={deletionDialog}
        key={deletionDialogKey(deletionDialog)}
        onCancel={() => {
          if (!pending) setDeletionDialog(null);
        }}
        onDelete={(reason) => {
          if (deletionDialog?.kind === "delete_submission") {
            void changeDeletion(
              () =>
                api.softDelete("submission", deletionDialog.item.entry.id, {
                  expectedUpdatedAt: deletionDialog.item.entry.updatedAt,
                  reason,
                }),
              "Submission moved to deleted records.",
            );
          } else if (deletionDialog?.kind === "delete_help") {
            void changeDeletion(
              () =>
                api.softDelete("help", deletionDialog.item.draft.id, {
                  expectedUpdatedAt: deletionDialog.item.draft.lastEditedAt,
                  reason,
                }),
              "Help request moved to deleted records.",
            );
          }
        }}
        onRestore={() => {
          if (deletionDialog?.kind !== "restore") return;
          const item = deletionDialog.item;
          const id = item.kind === "submission" ? item.entry.id : item.draft.id;
          const expectedUpdatedAt =
            item.kind === "submission"
              ? item.entry.updatedAt
              : item.draft.lastEditedAt;
          void changeDeletion(
            () => api.restoreDeleted(item.kind, id, { expectedUpdatedAt }),
            "Approval work restored.",
          );
        }}
        pending={pending}
      />
      <ApprovalDialogs
        dialog={approvalDialog}
        key={dialogKey(approvalDialog)}
        onApprove={(queueEntryId) =>
          void resolve(
            { id: queueEntryId, kind: "submission" },
            () => api.approve(queueEntryId),
          )
        }
        onBulkApprove={(queueEntryIds) => void bulkApprove(queueEntryIds)}
        onCancel={cancelDialog}
        onEditFix={(queueEntryId, input: UpdateDraftRequest) =>
          void resolve(
            { id: queueEntryId, kind: "submission" },
            () => api.editFixSubmission(queueEntryId, input),
          )
        }
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
        user={user}
      />
      <PolicyChangeRequestDialogs
        dialog={policyChangeDialog}
        key={policyChangeDialogKey(policyChangeDialog)}
        onCancel={cancelDialog}
        onChooseCorrection={(kind) =>
          setDialog((current) =>
            current?.kind === "change_request_fix_choice"
              ? {
                  ...current,
                  kind:
                    kind === "general"
                      ? "change_request_general"
                      : "change_request_override",
                }
              : current,
          )
        }
        onCorrect={(input: PolicyLedgerCorrectionRequest) => {
          if (!isPolicyChangeRequestDialog(dialog)) return;
          void resolve(
            { id: dialog.item.request.id, kind: "change_request" },
            () => api.correctPolicyChangeRequest(dialog.item.request.id, input),
          );
        }}
        onResolveAsIs={() => {
          if (policyChangeDialog?.kind !== "change_request_as_is") return;
          void resolve(
            { id: policyChangeDialog.item.request.id, kind: "change_request" },
            () =>
              api.resolvePolicyChangeRequestAsIs(
                policyChangeDialog.item.request.id,
              ),
          );
        }}
        onSendBack={(reason) => {
          if (policyChangeDialog?.kind !== "change_request_send_back") return;
          void resolve(
            { id: policyChangeDialog.item.request.id, kind: "change_request" },
            () =>
              api.sendBackPolicyChangeRequest(
                policyChangeDialog.item.request.id,
                { reason },
              ),
          );
        }}
        pending={pending}
      />
    </>
  );
}

export function ApprovalQueueView({
  bulkResults,
  expandedSubmissionIds,
  filter,
  lookups,
  notice,
  onApproveSelected,
  onDeleteHelp,
  onDeleteSubmission,
  onExpandSubmission,
  onExpandSubmissions,
  onFilter,
  onInlineApprove,
  onOpenHelpFix,
  onOpenChangeFix,
  onOpenDeleted,
  onOpen,
  onOpenSubmissionFix,
  onRetry,
  onSelectSubmission,
  onSelectSubmissions,
  pending,
  selectedSubmissionIds,
  state,
}: {
  bulkResults: readonly BulkApprovalResult[];
  expandedSubmissionIds: ReadonlySet<string>;
  filter: ApprovalFilter;
  lookups: ApprovalValueLookups;
  notice: string | null;
  onApproveSelected(items: Submission[]): void;
  onDeleteHelp(item: HelpRequest): void;
  onDeleteSubmission(item: Submission): void;
  onExpandSubmission(id: string, expanded: boolean): void;
  onExpandSubmissions(expanded: boolean): void;
  onFilter(filter: ApprovalFilter): void;
  onInlineApprove(item: Submission): void;
  onOpenHelpFix(item: HelpRequest): void;
  onOpen(dialog: QueueDialog): void;
  onOpenSubmissionFix(item: Submission): void;
  onOpenChangeFix(item: ChangeRequest): void;
  onOpenDeleted(): void;
  onRetry(): void;
  onSelectSubmission(id: string, selected: boolean): void;
  onSelectSubmissions(selected: boolean): void;
  pending: boolean;
  selectedSubmissionIds: ReadonlySet<string>;
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

  const total =
    state.work.submissions.length +
    state.work.helpRequests.length +
    state.work.changeRequests.length;
  const submissionPriority = groupApprovalSubmissions(state.work.submissions);
  const orderedSubmissions = submissionPriority.groups.flatMap(
    ({ items }) => items,
  );
  const selectedSubmissions = orderedSubmissions.filter(({ entry }) =>
    selectedSubmissionIds.has(entry.id),
  );
  const allSubmissionsSelected =
    state.work.submissions.length > 0 &&
    selectedSubmissions.length === state.work.submissions.length;
  const allSubmissionsExpanded =
    state.work.submissions.length > 0 &&
    state.work.submissions.every(({ entry }) =>
      expandedSubmissionIds.has(entry.id),
    );
  return (
    <section className="approval-page" aria-labelledby="approval-page-title">
      <PageHeader
        actions={(
          <button
            className="approval-deleted-button"
            disabled={pending}
            onClick={onOpenDeleted}
            type="button"
          >
            Deleted work ({state.deleted.items.length})
          </button>
        )}
        eyebrow="Policy review"
        status={(
          <>
            <strong>{total}</strong> {total === 1 ? "open item is" : "open items are"} waiting for review.
          </>
        )}
        title="Approvals"
        titleId="approval-page-title"
      />

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

      {bulkResults.length === 0 ? null : (
        <div className="approval-bulk-results" aria-label="Bulk approval results">
          {bulkResults.map((result) => (
            <div className={`is-${result.status}`} key={result.id}>
              <strong>{result.name}</strong>
              <span>{result.status === "approved" ? "Approved" : "Not approved"}</span>
            </div>
          ))}
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          action={filter === "all" ? (
            <a href="#/turn-in">Start a turn-in</a>
          ) : (
            <button disabled={pending} onClick={() => onFilter("all")} type="button">Show all</button>
          )}
          body={filter === "all"
            ? "Submitted turn-ins and help requests will appear here when they need an administrator's decision."
            : "There is no work in this part of the queue right now."}
          className="approval-empty"
          heading={filter === "pending"
            ? "No pending submissions"
            : filter === "flagged"
              ? "No help requests in this view"
              : "Nothing waiting for review"}
        />
      ) : (
        <div className="approval-work-list">
          {state.work.submissions.length === 0 ? null : (
            <section aria-labelledby="pending-approvals-title">
              <div className="approval-section-heading">
                <h2 id="pending-approvals-title">Pending submissions</h2>
                <span>{state.work.submissions.length}</span>
              </div>
              <div className="approval-bulk-toolbar" aria-label="Pending submission controls">
                <label>
                  <input
                    checked={allSubmissionsSelected}
                    disabled={pending}
                    onChange={(event) =>
                      onSelectSubmissions(event.currentTarget.checked)
                    }
                    type="checkbox"
                  />
                  <span>Select all</span>
                </label>
                <button
                  className="is-primary"
                  disabled={pending || selectedSubmissions.length === 0}
                  onClick={() => onApproveSelected(selectedSubmissions)}
                  type="button"
                >
                  Approve selected ({selectedSubmissions.length})
                </button>
                <button
                  disabled={pending}
                  onClick={() => onExpandSubmissions(!allSubmissionsExpanded)}
                  type="button"
                >
                  {allSubmissionsExpanded ? "Collapse all" : "Expand all"}
                </button>
              </div>
              {submissionPriority.groups.map((group) => (
                <React.Fragment key={group.key}>
                  {submissionPriority.showHeadings ? (
                    <div className={`approval-priority-heading is-${group.key}`}>
                      <strong>{group.title}</strong>
                      <span>{group.items.length}</span>
                    </div>
                  ) : null}
                  {group.items.map((item) => (
                    <SubmissionReview
                      expanded={expandedSubmissionIds.has(item.entry.id)}
                      item={item}
                      key={item.entry.id}
                      lookups={lookups}
                      onDelete={onDeleteSubmission}
                      onExpanded={(expanded) =>
                        onExpandSubmission(item.entry.id, expanded)
                      }
                      onInlineApprove={onInlineApprove}
                      onEditFix={onOpenSubmissionFix}
                      onOpen={onOpen}
                      onSelected={(selected) =>
                        onSelectSubmission(item.entry.id, selected)
                      }
                      pending={pending}
                      selected={selectedSubmissionIds.has(item.entry.id)}
                    />
                  ))}
                </React.Fragment>
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
                  onDelete={onDeleteHelp}
                  onOpenFix={onOpenHelpFix}
                  onOpen={onOpen}
                  pending={pending}
                />
              ))}
            </section>
          )}

          {state.work.changeRequests.length === 0 ? null : (
            <section aria-labelledby="change-request-approvals-title">
              <div className="approval-section-heading">
                <h2 id="change-request-approvals-title">Approved-policy change requests</h2>
                <span>{state.work.changeRequests.length}</span>
              </div>
              {state.work.changeRequests.map((item) => (
                <ChangeRequestReview
                  item={item}
                  key={item.request.id}
                  onOpen={onOpen}
                  onOpenFix={onOpenChangeFix}
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
  expanded,
  item,
  lookups,
  onDelete,
  onEditFix,
  onExpanded,
  onInlineApprove,
  onOpen,
  onSelected,
  pending,
  selected,
}: {
  expanded: boolean;
  item: Submission;
  lookups: ApprovalValueLookups;
  onDelete(item: Submission): void;
  onEditFix(item: Submission): void;
  onExpanded(expanded: boolean): void;
  onInlineApprove(item: Submission): void;
  onOpen(dialog: ApprovalDialog): void;
  onSelected(selected: boolean): void;
  pending: boolean;
  selected: boolean;
}) {
  const source = item.entry.submittedPayload;
  const reviewBadge = approvalReviewBadge(item);
  return (
    <details
      className="approval-review-row is-submission"
      onToggle={(event) => onExpanded(event.currentTarget.open)}
      open={expanded}
    >
      <summary>
        <span
          className="approval-row-select"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            aria-label={`Select ${String(source.insuredName ?? "unnamed insured")}`}
            checked={selected}
            disabled={pending}
            onChange={(event) => onSelected(event.currentTarget.checked)}
            type="checkbox"
          />
        </span>
        <span className="approval-status is-pending">Pending</span>
        <span className="approval-review-primary">
          <strong>{String(source.insuredName ?? "Unnamed insured")}</strong>
          <span>{item.submitterDisplayName ?? "Unknown submitter"}</span>
          {reviewBadge === null ? null : (
            <span className="approval-review-badge">
              {reviewBadge}
            </span>
          )}
        </span>
        <span className="approval-review-policy">
          <strong>{String(source.policyNumber ?? "Policy pending")}</strong>
          <span>{String(source.transactionType ?? "Transaction pending")}</span>
        </span>
        <span className="approval-review-amount">
          {reviewSourceValue(source, { key: "netDue", label: "Net due", money: true })}
        </span>
        <span className="approval-review-time">{formatTimestamp(item.entry.submittedAt)}</span>
        <button
          className="approval-inline-approve"
          disabled={pending}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onInlineApprove(item);
          }}
          type="button"
        >
          Approve
        </button>
      </summary>
      <div className="approval-review-body">
        <ReviewFields lookups={lookups} source={source} />
        <div className="approval-row-actions">
          <button disabled={pending} onClick={() => onEditFix(item)} type="button">Edit &amp; fix</button>
          <button disabled={pending} onClick={() => onOpen({ item, kind: "approve" })} type="button">Approve</button>
          <button className="is-override" disabled={pending} onClick={() => onOpen({ item, kind: "override" })} type="button">Approve with override</button>
          <button className="is-danger" disabled={pending} onClick={() => onOpen({ item, kind: "send_back_submission" })} type="button">Send back</button>
          <button className="is-danger" disabled={pending} onClick={() => onDelete(item)} type="button">Delete</button>
        </div>
      </div>
    </details>
  );
}

function HelpReview({
  item,
  lookups,
  onDelete,
  onOpenFix,
  onOpen,
  pending,
}: {
  item: HelpRequest;
  lookups: ApprovalValueLookups;
  onDelete(item: HelpRequest): void;
  onOpenFix(item: HelpRequest): void;
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
          <button disabled={pending} onClick={() => onOpenFix(item)} type="button">Open &amp; fix</button>
          <button className="is-primary" disabled={pending} onClick={() => onOpen({ item, kind: "push_through" })} type="button">Push through as-is</button>
          <button className="is-danger" disabled={pending} onClick={() => onOpen({ item, kind: "send_back_help" })} type="button">Send back</button>
          <button className="is-danger" disabled={pending} onClick={() => onDelete(item)} type="button">Delete</button>
        </div>
      </div>
    </details>
  );
}

function ChangeRequestReview({
  item,
  onOpen,
  onOpenFix,
  pending,
}: {
  item: ChangeRequest;
  onOpen(dialog: QueueDialog): void;
  onOpenFix(item: ChangeRequest): void;
  pending: boolean;
}) {
  return (
    <details className="approval-review-row is-help">
      <summary>
        <span className="approval-status is-flagged">Change</span>
        <span className="approval-review-primary">
          <strong>{item.insuredName}</strong>
          <span>{item.requesterDisplayName}</span>
        </span>
        <span className="approval-review-policy">
          <strong>{item.policyNumber}</strong>
          <span>Approved policy</span>
        </span>
        <span className="approval-review-amount">Reason only</span>
        <span className="approval-review-time">
          {formatTimestamp(item.request.requestedAt)}
        </span>
      </summary>
      <div className="approval-review-body">
        <div className="approval-help-reason">
          <strong>Change requested</strong>
          <p>{item.request.reason}</p>
        </div>
        <div className="approval-row-actions">
          <button disabled={pending} onClick={() => onOpenFix(item)} type="button">
            Open &amp; fix
          </button>
          <button
            className="is-primary"
            disabled={pending}
            onClick={() => onOpen({ item, kind: "change_request_as_is" })}
            type="button"
          >
            Push through as-is
          </button>
          <button
            className="is-danger"
            disabled={pending}
            onClick={() => onOpen({ item, kind: "change_request_send_back" })}
            type="button"
          >
            Send back
          </button>
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
  if (dialog.kind === "bulk_approve") {
    return `bulk-approve:${dialog.items.map(({ entry }) => entry.id).join(",")}`;
  }
  return `${dialog.kind}:${"entry" in dialog.item ? dialog.item.entry.id : dialog.item.draft.id}`;
}

function policyChangeDialogKey(
  dialog: PolicyChangeRequestDialog | null,
): string {
  return dialog === null ? "change-closed" : `${dialog.kind}:${dialog.item.request.id}`;
}

function deletionDialogKey(
  dialog: ApprovalWorkDeletionDialog | null,
): string {
  if (dialog === null) return "deletion-closed";
  if (dialog.kind === "delete_submission") {
    return `delete-submission:${dialog.item.entry.id}`;
  }
  if (dialog.kind === "delete_help") {
    return `delete-help:${dialog.item.draft.id}`;
  }
  return `restore:${dialog.item.kind}:${
    dialog.item.kind === "submission"
      ? dialog.item.entry.id
      : dialog.item.draft.id
  }`;
}

function isPolicyChangeRequestDialog(
  dialog: QueueDialog | null,
): dialog is PolicyChangeRequestDialog {
  return dialog !== null && dialog.kind.startsWith("change_request_");
}

function isApprovalDialog(dialog: QueueDialog | null): dialog is ApprovalDialog {
  return dialog !== null && !isPolicyChangeRequestDialog(dialog);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
