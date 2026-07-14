import React, { useEffect, useRef, useState } from "react";
import type { DraftAssignmentOption } from "../../../shared/draft-assignment-options.js";
import type { AdminPolicyChangeRequest } from "../../../shared/policy-change-requests.js";
import type { PolicyLedgerCorrectionRequest } from "../../../shared/policy-corrections.js";
import type { PolicyLedgerItem } from "../../../shared/policy-ledger.js";
import {
  PolicyCorrectionDialog,
} from "../ledger/CorrectionDialogs.js";
import { DialogActions, DialogFrame } from "./ApprovalDialogs.js";

export type PolicyChangeRequestDialog =
  | {
      assignmentOptions: readonly DraftAssignmentOption[];
      item: AdminPolicyChangeRequest;
      kind: "change_request_fix_choice";
      policy: PolicyLedgerItem;
    }
  | {
      assignmentOptions: readonly DraftAssignmentOption[];
      item: AdminPolicyChangeRequest;
      kind: "change_request_general" | "change_request_override";
      policy: PolicyLedgerItem;
    }
  | {
      item: AdminPolicyChangeRequest;
      kind: "change_request_as_is" | "change_request_send_back";
    };

export function PolicyChangeRequestDialogs({
  dialog,
  onCancel,
  onChooseCorrection,
  onCorrect,
  onResolveAsIs,
  onSendBack,
  pending,
}: {
  dialog: PolicyChangeRequestDialog | null;
  onCancel(): void;
  onChooseCorrection(kind: "general" | "override"): void;
  onCorrect(input: PolicyLedgerCorrectionRequest): void;
  onResolveAsIs(): void;
  onSendBack(reason: string): void;
  pending: boolean;
}) {
  if (dialog === null) return null;
  if (
    dialog.kind === "change_request_general" ||
    dialog.kind === "change_request_override"
  ) {
    return (
      <PolicyCorrectionDialog
        assignmentOptions={dialog.assignmentOptions}
        dialog={{
          item: dialog.policy,
          kind: dialog.kind === "change_request_general" ? "general" : "override",
        }}
        onCancel={onCancel}
        onSubmit={onCorrect}
        pending={pending}
      />
    );
  }
  if (dialog.kind === "change_request_fix_choice") {
    return (
      <CorrectionChoiceDialog
        item={dialog.item}
        onCancel={onCancel}
        onChoose={onChooseCorrection}
        pending={pending}
      />
    );
  }
  if (dialog.kind === "change_request_as_is") {
    return (
      <DialogFrame
        onCancel={onCancel}
        pending={pending}
        title={`Keep ${dialog.item.insuredName} as-is?`}
      >
        <p className="approval-dialog-copy">
          This closes the request after review without changing the approved policy.
        </p>
        <DialogActions>
          <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
          <button className="is-primary" disabled={pending} onClick={onResolveAsIs} type="button">
            {pending ? "Working..." : "Push through as-is"}
          </button>
        </DialogActions>
      </DialogFrame>
    );
  }
  return (
    <ChangeRequestSendBackDialog
      item={dialog.item}
      onCancel={onCancel}
      onSubmit={onSendBack}
      pending={pending}
    />
  );
}

function CorrectionChoiceDialog({
  item,
  onCancel,
  onChoose,
  pending,
}: {
  item: AdminPolicyChangeRequest;
  onCancel(): void;
  onChoose(kind: "general" | "override"): void;
  pending: boolean;
}) {
  return (
    <DialogFrame
      onCancel={onCancel}
      pending={pending}
      title={`Open and fix ${item.insuredName}`}
    >
      <p className="approval-dialog-copy">
        Correct the original ledger policy through one of its existing audited paths.
      </p>
      <div className="change-request-correction-options">
        <button disabled={pending} onClick={() => onChoose("general")} type="button">
          Correct policy details
        </button>
        <button className="is-override" disabled={pending} onClick={() => onChoose("override")} type="button">
          Apply financial override
        </button>
      </div>
      <DialogActions>
        <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
      </DialogActions>
    </DialogFrame>
  );
}

function ChangeRequestSendBackDialog({
  item,
  onCancel,
  onSubmit,
  pending,
}: {
  item: AdminPolicyChangeRequest;
  onCancel(): void;
  onSubmit(reason: string): void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => reasonRef.current?.focus());
  }, []);
  const submit = () => {
    const normalized = reason.trim();
    if (normalized.length < 1 || normalized.length > 500) {
      setError(true);
      reasonRef.current?.focus();
      return;
    }
    onSubmit(normalized);
  };
  return (
    <DialogFrame
      onCancel={onCancel}
      pending={pending}
      title={`Send ${item.insuredName} request back`}
    >
      <label className="approval-dialog-field" htmlFor="change-request-send-back-reason">
        <span>Reason</span>
        <textarea
          aria-invalid={error}
          disabled={pending}
          id="change-request-send-back-reason"
          maxLength={500}
          onChange={(event) => {
            setReason(event.currentTarget.value);
            setError(false);
          }}
          ref={reasonRef}
          rows={4}
          value={reason}
        />
      </label>
      {error ? (
        <p className="approval-dialog-error" role="alert">
          Enter a reason between 1 and 500 characters.
        </p>
      ) : null}
      <DialogActions>
        <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
        <button className="is-danger" disabled={pending} onClick={submit} type="button">
          {pending ? "Sending..." : "Send back"}
        </button>
      </DialogActions>
    </DialogFrame>
  );
}
