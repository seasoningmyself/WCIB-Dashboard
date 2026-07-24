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
} from "../../../shared/approval-queue.js";
import type {
  DeletedApprovalWorkListResponse,
  DeletedApprovalWorkItem,
} from "../../../shared/approval-work-deletions.js";
import type { UpdateDraftRequest } from "../../../shared/drafts.js";
import type { ApproveWithOverrideRequest } from "../../../shared/policy-overrides.js";
import type { PolicyLedgerCorrectionRequest } from "../../../shared/policy-corrections.js";
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

export type ApprovalQueueViewId = "submitted_turn_ins" | "policy_changes";
type Submission = ApprovalWorkListResponse["submissions"][number];
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

export function ApprovalQueue({
  activeView,
  reviewNavigation,
  user,
}: {
  activeView: ApprovalQueueViewId;
  reviewNavigation?: React.ReactNode;
  user: CurrentUser;
}) {
  return isApprovalAdmin(user) ? (
    <AdminApprovalQueue
      activeView={activeView}
      reviewNavigation={reviewNavigation}
      user={user}
    />
  ) : (
    <ApprovalMessage
      body="This page is not available for your account."
      title="Approvals unavailable"
    />
  );
}

function AdminApprovalQueue({
  activeView,
  reviewNavigation,
  user,
}: {
  activeView: ApprovalQueueViewId;
  reviewNavigation?: React.ReactNode;
  user: CurrentUser;
}) {
  const client = useApiClient();
  const api = useMemo(() => createApprovalApi(client), [client]);
  const ledgerApi = useMemo(() => createPolicyLedgerApi(client), [client]);
  const vocabulary = useVocabulary();
  const [state, setState] = useState<ApprovalQueueState>({ status: "loading" });
  const [dialog, setDialog] = useState<QueueDialog | null>(null);
  const [deletionDialog, setDeletionDialog] =
    useState<ApprovalWorkDeletionDialog | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedbackState | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkApprovalResult[]>([]);
  const [activeWorkId, setActiveWorkId] = useState<string | null>(null);
  const [departingWorkIds, setDepartingWorkIds] = useState<Set<string>>(
    () => new Set(),
  );
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
        api.list({ status: "all" }),
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
  }, [api, ledgerApi]);

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
    setFeedback(null);
    setBulkResults([]);
    setActiveWorkId(null);
    setDepartingWorkIds(new Set());
    setProducerOptions([]);
    setSelectedSubmissionIds(new Set());
    setExpandedSubmissionIds(new Set());
    pendingRef.current = false;
    setPending(false);
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const resolve: (
    target: ApprovalResolutionTarget,
    action: () => Promise<unknown>,
    successMessage?: string,
  ) => Promise<void> = useCallback(
    async (
      target: ApprovalResolutionTarget,
      action: () => Promise<unknown>,
      successMessage = "Review action completed.",
    ) => {
      if (pendingRef.current) {
        return;
      }
      pendingRef.current = true;
      setPending(true);
      setActiveWorkId(target.id);
      setNotice(null);
      setFeedback(null);
      setBulkResults([]);
      try {
        await action();
        setDepartingWorkIds(new Set([target.id]));
        setFeedback({ kind: "success", message: successMessage });
        await waitForApprovalRowDeparture();
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
        if (error instanceof ApprovalApiError && error.kind === "denied") {
          requestVersion.current += 1;
          setState({ status: "denied" });
          setNotice(null);
          setDialog(null);
        } else if (
          error instanceof ApprovalApiError &&
          error.kind === "conflict"
        ) {
          setDialog(null);
          setNotice("That item changed while it was open. The queue has been refreshed.");
          await load();
        } else if (
          error instanceof ApprovalApiError &&
          error.kind === "rejected"
        ) {
          setFeedback({
            actionLabel: "Retry",
            kind: "error",
            message: "The action was rejected. Review the values and try again.",
            onAction: () => void resolve(target, action, successMessage),
          });
        } else {
          setFeedback({
            actionLabel: "Retry",
            kind: "error",
            message: "The action could not be completed. Try again.",
            onAction: () => void resolve(target, action, successMessage),
          });
        }
      } finally {
        setActiveWorkId(null);
        setDepartingWorkIds(new Set());
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

  const undoApprovalDeletion: (
    item: DeletedApprovalWorkItem,
  ) => Promise<void> = useCallback(
    async (item) => {
      if (pendingRef.current) return;
      const id = item.kind === "submission" ? item.entry.id : item.draft.id;
      const expectedUpdatedAt =
        item.kind === "submission"
          ? item.entry.updatedAt
          : item.draft.lastEditedAt;
      pendingRef.current = true;
      setPending(true);
      setActiveWorkId(id);
      setFeedback(null);
      try {
        await api.restoreDeleted(item.kind, id, { expectedUpdatedAt });
        setFeedback({
          kind: "success",
          message: "Approval work restored.",
        });
        await load();
      } catch (error) {
        setFeedback({
          actionLabel: "Retry",
          kind: "error",
          message:
            error instanceof ApprovalApiError && error.kind === "conflict"
              ? "That record changed before Undo could finish. Refresh and review it."
              : "Undo could not restore the record. It remains in deleted work.",
          onAction: () => void undoApprovalDeletion(item),
        });
      } finally {
        setActiveWorkId(null);
        pendingRef.current = false;
        setPending(false);
      }
    },
    [api, load],
  );

  async function changeDeletion<Result>(
    action: () => Promise<Result>,
    onSuccess: (result: Result) => void | Promise<void>,
  ) {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      setFeedback(null);
      try {
        const result = await action();
        setDeletionDialog(null);
        await onSuccess(result);
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
        setActiveWorkId(null);
        setDepartingWorkIds(new Set());
        pendingRef.current = false;
        setPending(false);
      }
  }

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
        setDepartingWorkIds(approvedIds);
        if (approvedIds.size > 0) {
          await waitForApprovalRowDeparture();
        }
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
        setDepartingWorkIds(new Set());
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
        activeView={activeView}
        bulkResults={bulkResults}
        activeWorkId={activeWorkId}
        departingWorkIds={departingWorkIds}
        expandedSubmissionIds={expandedSubmissionIds}
        lookups={lookups}
        notice={notice}
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
            "Submission approved and added to the ledger.",
          )
        }
        onOpenChangeFix={(item) => void openPolicyChangeRequest(item)}
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
        reviewNavigation={reviewNavigation}
        selectedSubmissionIds={selectedSubmissionIds}
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
              async (result) => {
                setDepartingWorkIds(new Set([deletionDialog.item.entry.id]));
                setFeedback({
                  actionLabel: "Undo",
                  kind: "success",
                  message: "Submission moved to deleted records.",
                  onAction: () => void undoApprovalDeletion(result.item),
                });
                await waitForApprovalRowDeparture();
              },
            );
          } else if (deletionDialog?.kind === "delete_help") {
            void changeDeletion(
              () =>
                api.softDelete("help", deletionDialog.item.draft.id, {
                  expectedUpdatedAt: deletionDialog.item.draft.lastEditedAt,
                  reason,
                }),
              async (result) => {
                setDepartingWorkIds(new Set([deletionDialog.item.draft.id]));
                setFeedback({
                  actionLabel: "Undo",
                  kind: "success",
                  message: "Help request moved to deleted records.",
                  onAction: () => void undoApprovalDeletion(result.item),
                });
                await waitForApprovalRowDeparture();
              },
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
            () => setNotice("Approval work restored."),
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
            "Submission approved and added to the ledger.",
          )
        }
        onBulkApprove={(queueEntryIds) => void bulkApprove(queueEntryIds)}
        onCancel={cancelDialog}
        onEditFix={(queueEntryId, input: UpdateDraftRequest) =>
          void resolve(
            { id: queueEntryId, kind: "submission" },
            () => api.editFixSubmission(queueEntryId, input),
            "Corrected submission approved and added to the ledger.",
          )
        }
        onOpenFix={(draftId, input: UpdateDraftRequest) =>
          void resolve(
            { id: draftId, kind: "help" },
            () => api.openFixHelp(draftId, input),
            "Help request corrected and approved.",
          )
        }
        onOverride={(queueEntryId, input: ApproveWithOverrideRequest) =>
          void resolve(
            { id: queueEntryId, kind: "submission" },
            () => api.approveWithOverride(queueEntryId, input),
            "Submission approved with a financial override.",
          )
        }
        onPushThrough={(draftId) =>
          void resolve(
            { id: draftId, kind: "help" },
            () => api.pushThroughHelp(draftId),
            "Help request approved as submitted.",
          )
        }
        onSendBack={(kind, id, reason) =>
          void resolve(
            { id, kind },
            () =>
              kind === "help"
                ? api.sendBackHelp(id, { reason })
                : api.sendBackSubmission(id, { reason }),
            kind === "help"
              ? "Help request sent back."
              : "Submission sent back.",
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
  activeWorkId = null,
  activeView,
  bulkResults,
  departingWorkIds = new Set(),
  expandedSubmissionIds,
  lookups,
  notice,
  onApproveSelected,
  onDeleteSubmission,
  onExpandSubmission,
  onExpandSubmissions,
  onInlineApprove,
  onOpenChangeFix,
  onOpenDeleted,
  onOpen,
  onOpenSubmissionFix,
  onRetry,
  onSelectSubmission,
  onSelectSubmissions,
  now = new Date(),
  pending,
  reviewNavigation,
  selectedSubmissionIds,
  state,
}: {
  activeWorkId?: string | null;
  activeView: ApprovalQueueViewId;
  bulkResults: readonly BulkApprovalResult[];
  departingWorkIds?: ReadonlySet<string>;
  expandedSubmissionIds: ReadonlySet<string>;
  lookups: ApprovalValueLookups;
  notice: string | null;
  onApproveSelected(items: Submission[]): void;
  onDeleteSubmission(item: Submission): void;
  onExpandSubmission(id: string, expanded: boolean): void;
  onExpandSubmissions(expanded: boolean): void;
  onInlineApprove(item: Submission): void;
  onOpen(dialog: QueueDialog): void;
  onOpenSubmissionFix(item: Submission): void;
  onOpenChangeFix(item: ChangeRequest): void;
  onOpenDeleted(): void;
  onRetry(): void;
  onSelectSubmission(id: string, selected: boolean): void;
  onSelectSubmissions(selected: boolean): void;
  now?: Date;
  pending: boolean;
  reviewNavigation?: React.ReactNode;
  selectedSubmissionIds: ReadonlySet<string>;
  state: ApprovalQueueState;
}) {
  if (state.status === "loading") {
    return (
      <ApprovalMessage
        body="Retrieving submitted policies and help requests..."
        busy
        reviewNavigation={reviewNavigation}
        title="Loading approvals"
      />
    );
  }
  if (state.status === "error") {
    return (
      <ApprovalMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="The approval queue could not be loaded."
        reviewNavigation={reviewNavigation}
        title="Approvals unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <ApprovalMessage
        body="This page is not available for your account."
        reviewNavigation={reviewNavigation}
        title="Approvals unavailable"
      />
    );
  }

  const total =
    activeView === "submitted_turn_ins"
      ? state.work.submissions.length
      : state.work.changeRequests.length;
  const itemLabel =
    activeView === "submitted_turn_ins"
      ? total === 1
        ? "submitted turn-in needs"
        : "submitted turn-ins need"
      : total === 1
        ? "policy change needs"
        : "policy changes need";
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
            <strong>{total}</strong> {itemLabel} review.
          </>
        )}
        title="Review Queue"
        titleId="approval-page-title"
      />

      {reviewNavigation}

      {notice === null ? null : (
        <div className="approval-notice" role="status">{notice}</div>
      )}

      {activeView !== "submitted_turn_ins" || bulkResults.length === 0 ? null : (
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
          body={
            activeView === "submitted_turn_ins"
              ? "New submissions will appear here after staff send a turn-in for administrator review."
              : "Requests to change an approved policy will appear here when they need an administrator's decision."
          }
          className="approval-empty"
          heading={
            activeView === "submitted_turn_ins"
              ? "No turn-ins are waiting for review"
              : "No policy changes are waiting for review"
          }
        />
      ) : (
        <div className="approval-work-list">
          {activeView !== "submitted_turn_ins" ? null : (
            <section aria-labelledby="pending-approvals-title">
              <h2 className="sr-only" id="pending-approvals-title">
                Submitted turn-ins
              </h2>
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
                  data-bulk-approve
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
                      departing={departingWorkIds.has(item.entry.id)}
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
                      now={now}
                      pending={pending}
                      rowPending={activeWorkId === item.entry.id}
                      selected={selectedSubmissionIds.has(item.entry.id)}
                    />
                  ))}
                </React.Fragment>
              ))}
            </section>
          )}

          {activeView !== "policy_changes" ? null : (
            <section aria-labelledby="change-request-approvals-title">
              <h2 className="sr-only" id="change-request-approvals-title">
                Approved-policy change requests
              </h2>
              {state.work.changeRequests.map((item) => (
                <ChangeRequestReview
                  item={item}
                  key={item.request.id}
                  departing={departingWorkIds.has(item.request.id)}
                  now={now}
                  onOpen={onOpen}
                  onOpenFix={onOpenChangeFix}
                  pending={pending}
                  rowPending={activeWorkId === item.request.id}
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
  departing,
  expanded,
  item,
  lookups,
  onDelete,
  onEditFix,
  onExpanded,
  onInlineApprove,
  onOpen,
  onSelected,
  now,
  pending,
  rowPending,
  selected,
}: {
  departing: boolean;
  expanded: boolean;
  item: Submission;
  lookups: ApprovalValueLookups;
  onDelete(item: Submission): void;
  onEditFix(item: Submission): void;
  onExpanded(expanded: boolean): void;
  onInlineApprove(item: Submission): void;
  onOpen(dialog: ApprovalDialog): void;
  onSelected(selected: boolean): void;
  now: Date;
  pending: boolean;
  rowPending: boolean;
  selected: boolean;
}) {
  const source = item.entry.submittedPayload;
  const reviewBadge = approvalReviewBadge(item);
  return (
    <details
      aria-busy={rowPending || undefined}
      className={`approval-review-row is-submission${
        departing ? " is-departing" : ""
      }`}
      data-keyboard-row
      onToggle={(event) => onExpanded(event.currentTarget.open)}
      open={expanded}
    >
      <summary data-row-focus-target data-row-primary-action>
        <label
          className="approval-row-select"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            aria-label={`Select ${String(source.insuredName ?? "unnamed insured")}`}
            checked={selected}
            data-row-select
            disabled={pending}
            onChange={(event) => onSelected(event.currentTarget.checked)}
            type="checkbox"
          />
        </label>
        <span className="approval-status is-pending">
          {rowPending ? "Working" : "Pending"}
        </span>
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
          <small>Net due</small>
          <strong>
            {reviewSourceValue(source, { key: "netDue", label: "Net due", money: true })}
          </strong>
        </span>
        <span className="approval-review-time">
          <time
            dateTime={item.entry.submittedAt}
            title={formatAbsoluteTimestamp(item.entry.submittedAt)}
          >
            {formatRelativeTime(item.entry.submittedAt, now)}
          </time>
        </span>
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
          <button
            data-row-approve-action
            disabled={pending}
            onClick={() => onOpen({ item, kind: "approve" })}
            type="button"
          >
            Approve
          </button>
          <button className="is-override" disabled={pending} onClick={() => onOpen({ item, kind: "override" })} type="button">Approve with override</button>
          <button className="is-danger" disabled={pending} onClick={() => onOpen({ item, kind: "send_back_submission" })} type="button">Send back</button>
          <button className="is-danger" disabled={pending} onClick={() => onDelete(item)} type="button">Delete</button>
        </div>
      </div>
    </details>
  );
}

function ChangeRequestReview({
  departing,
  item,
  now,
  onOpen,
  onOpenFix,
  pending,
  rowPending,
}: {
  departing: boolean;
  item: ChangeRequest;
  now: Date;
  onOpen(dialog: QueueDialog): void;
  onOpenFix(item: ChangeRequest): void;
  pending: boolean;
  rowPending: boolean;
}) {
  return (
    <details
      aria-busy={rowPending || undefined}
      className={`approval-review-row is-help${
        departing ? " is-departing" : ""
      }`}
      data-keyboard-row
    >
      <summary data-row-focus-target data-row-primary-action>
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
          <time
            dateTime={item.request.requestedAt}
            title={formatAbsoluteTimestamp(item.request.requestedAt)}
          >
            {formatRelativeTime(item.request.requestedAt, now)}
          </time>
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
  reviewNavigation,
  title,
}: {
  action?: React.ReactNode;
  body: string;
  busy?: boolean;
  reviewNavigation?: React.ReactNode;
  title: string;
}) {
  return (
    <section className="approval-message" aria-busy={busy} aria-labelledby="approval-message-title">
      <h1 id="approval-message-title">{title}</h1>
      <p>{body}</p>
      {action}
      {reviewNavigation}
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

function waitForApprovalRowDeparture(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 160));
}
