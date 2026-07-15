import React, { useEffect, useRef, useState } from "react";
import type { ApprovalWorkListResponse } from "../../../shared/approval-queue.js";
import type {
  DeletedApprovalWorkItem,
  DeletedApprovalWorkListResponse,
} from "../../../shared/approval-work-deletions.js";

type Submission = ApprovalWorkListResponse["submissions"][number];
type HelpRequest = ApprovalWorkListResponse["helpRequests"][number];

export type ApprovalWorkDeletionDialog =
  | { item: Submission; kind: "delete_submission" }
  | { item: HelpRequest; kind: "delete_help" }
  | { item: DeletedApprovalWorkItem; kind: "restore" };

export function ApprovalWorkDeletionDialogView({
  dialog,
  onCancel,
  onDelete,
  onRestore,
  pending,
}: {
  dialog: ApprovalWorkDeletionDialog | null;
  onCancel(): void;
  onDelete(reason: string): void;
  onRestore(): void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (dialog === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => reasonRef.current?.focus());
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog, onCancel, pending]);
  if (dialog === null) return null;

  const restoring = dialog.kind === "restore";
  const submit = () => {
    if (restoring) {
      onRestore();
      return;
    }
    const normalized = reason.trim();
    if (normalized.length < 1 || normalized.length > 500) {
      setInvalid(true);
      reasonRef.current?.focus();
      return;
    }
    onDelete(normalized);
  };
  return (
    <div className="approval-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="approval-work-deletion-title"
        aria-modal="true"
        className="approval-dialog"
        role="dialog"
      >
        <header>
          <h2 id="approval-work-deletion-title">
            {restoring ? "Restore" : "Delete"} {itemName(dialog.item)}
          </h2>
          <button
            aria-label="Close"
            disabled={pending}
            onClick={onCancel}
            title="Close"
            type="button"
          >
            ×
          </button>
        </header>
        <p className="approval-dialog-copy">
          {restoring
            ? "Restore this record to its prior pending or help state."
            : "Move this non-approved item and its draft to recoverable deleted records."}
        </p>
        {restoring ? null : (
          <label className="approval-dialog-field" htmlFor="approval-work-delete-reason">
            <span>Reason</span>
            <textarea
              aria-describedby={invalid ? "approval-work-delete-error" : undefined}
              aria-invalid={invalid}
              disabled={pending}
              id="approval-work-delete-reason"
              maxLength={500}
              onChange={(event) => {
                setReason(event.currentTarget.value);
                setInvalid(false);
              }}
              ref={reasonRef}
              rows={4}
              value={reason}
            />
          </label>
        )}
        {invalid ? (
          <p className="approval-dialog-error" id="approval-work-delete-error" role="alert">
            Enter a reason between 1 and 500 characters.
          </p>
        ) : null}
        <div className="approval-dialog-actions">
          <button disabled={pending} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className={restoring ? "is-primary" : "is-danger"}
            disabled={pending}
            onClick={submit}
            type="button"
          >
            {pending ? "Working..." : restoring ? "Restore" : "Delete"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function DeletedApprovalWorkPanel({
  data,
  onClose,
  onRestore,
  open,
  pending,
}: {
  data: DeletedApprovalWorkListResponse;
  onClose(): void;
  onRestore(item: DeletedApprovalWorkItem): void;
  open: boolean;
  pending: boolean;
}) {
  if (!open) return null;
  return (
    <div className="approval-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="deleted-approval-work-title"
        aria-modal="true"
        className="approval-dialog is-wide approval-deleted-panel"
        role="dialog"
      >
        <header>
          <div>
            <p>Recoverable records</p>
            <h2 id="deleted-approval-work-title">Deleted approval work</h2>
          </div>
          <button
            aria-label="Close deleted approval work"
            disabled={pending}
            onClick={onClose}
            title="Close"
            type="button"
          >
            ×
          </button>
        </header>
        {data.items.length === 0 ? (
          <p className="approval-deleted-status">No deleted approval work.</p>
        ) : (
          <div className="approval-deleted-list">
            {data.items.map((item) => (
              <article key={`${item.kind}:${itemId(item)}`}>
                <div>
                  <strong>{itemName(item)}</strong>
                  <span>
                    {item.kind === "submission" ? "Submission" : "Help request"}
                    {item.submitterDisplayName === null
                      ? ""
                      : ` · ${item.submitterDisplayName}`}
                  </span>
                  <small>
                    Deleted {formatDate(item.deletion.deletedAt)} · {item.deletion.reason}
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

function itemId(item: DeletedApprovalWorkItem): string {
  return item.kind === "submission" ? item.entry.id : item.draft.id;
}

function itemName(
  item:
    | ApprovalWorkDeletionDialog["item"]
    | DeletedApprovalWorkItem,
): string {
  if ("entry" in item) {
    return String(item.entry.submittedPayload.insuredName ?? "Unnamed insured");
  }
  return item.draft.insuredName ?? "Unnamed insured";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
