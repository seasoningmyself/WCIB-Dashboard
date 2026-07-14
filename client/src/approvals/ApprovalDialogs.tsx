import React, { useEffect, useRef, useState } from "react";
import type { ApprovalWorkListResponse } from "../../../shared/approval-queue.js";
import type { DraftResponse, UpdateDraftRequest } from "../../../shared/drafts.js";
import type { ApproveWithOverrideRequest } from "../../../shared/policy-overrides.js";
import { useVocabulary } from "../vocabulary/context.js";
import {
  turnInFormToDraftInput,
  turnInStateFromDraft,
  updateTurnInField,
  validateTurnInForSubmit,
  type TurnInFormState,
} from "../drafts/turn-in-state.js";
import { buildApprovalOverrideInput } from "./review-state.js";

type Submission = ApprovalWorkListResponse["submissions"][number];
type HelpRequest = ApprovalWorkListResponse["helpRequests"][number];

export type ApprovalDialog =
  | { item: Submission; kind: "approve" }
  | { item: Submission; kind: "override" }
  | { item: Submission; kind: "send_back_submission" }
  | { item: HelpRequest; kind: "open_fix" }
  | { item: HelpRequest; kind: "push_through" }
  | { item: HelpRequest; kind: "send_back_help" };

export function ApprovalDialogs({
  dialog,
  onApprove,
  onCancel,
  onOpenFix,
  onOverride,
  onPushThrough,
  onSendBack,
  pending,
}: {
  dialog: ApprovalDialog | null;
  onApprove(queueEntryId: string): void;
  onCancel(): void;
  onOpenFix(draftId: string, input: UpdateDraftRequest): void;
  onOverride(queueEntryId: string, input: ApproveWithOverrideRequest): void;
  onPushThrough(draftId: string): void;
  onSendBack(kind: "help" | "submission", id: string, reason: string): void;
  pending: boolean;
}) {
  useDialogLifecycle(dialog !== null, pending, onCancel);
  if (dialog === null) {
    return null;
  }
  if (dialog.kind === "approve") {
    return (
      <ConfirmationDialog
        confirmLabel="Approve to ledger"
        description="Approve the immutable submitted snapshot and create the ledger policy."
        onCancel={onCancel}
        onConfirm={() => onApprove(dialog.item.entry.id)}
        pending={pending}
        title={`Approve ${submissionName(dialog.item)}?`}
      />
    );
  }
  if (dialog.kind === "push_through") {
    return (
      <ConfirmationDialog
        confirmLabel="Push through as-is"
        description="Approve the flagged turn-in exactly as currently stored."
        onCancel={onCancel}
        onConfirm={() => onPushThrough(dialog.item.draft.id)}
        pending={pending}
        title={`Approve ${helpName(dialog.item)}?`}
      />
    );
  }
  if (dialog.kind === "override") {
    return (
      <OverrideDialog
        item={dialog.item}
        onCancel={onCancel}
        onSubmit={(input) => onOverride(dialog.item.entry.id, input)}
        pending={pending}
      />
    );
  }
  if (dialog.kind === "open_fix") {
    return (
      <OpenFixDialog
        draft={dialog.item.draft}
        onCancel={onCancel}
        onSubmit={(input) => onOpenFix(dialog.item.draft.id, input)}
        pending={pending}
      />
    );
  }
  return (
    <SendBackDialog
      name={
        dialog.kind === "send_back_help"
          ? helpName(dialog.item)
          : submissionName(dialog.item)
      }
      onCancel={onCancel}
      onSubmit={(reason) =>
        onSendBack(
          dialog.kind === "send_back_help" ? "help" : "submission",
          dialog.kind === "send_back_help"
            ? dialog.item.draft.id
            : dialog.item.entry.id,
          reason,
        )
      }
      pending={pending}
    />
  );
}

function ConfirmationDialog({
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  pending,
  title,
}: {
  confirmLabel: string;
  description: string;
  onCancel(): void;
  onConfirm(): void;
  pending: boolean;
  title: string;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => confirmRef.current?.focus());
  }, []);
  return (
    <DialogFrame onCancel={onCancel} pending={pending} title={title}>
      <p className="approval-dialog-copy">{description}</p>
      <DialogActions>
        <button disabled={pending} onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="is-primary"
          disabled={pending}
          onClick={onConfirm}
          ref={confirmRef}
          type="button"
        >
          {pending ? "Working..." : confirmLabel}
        </button>
      </DialogActions>
    </DialogFrame>
  );
}

function SendBackDialog({
  name,
  onCancel,
  onSubmit,
  pending,
}: {
  name: string;
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
      title={`Send ${name} back`}
    >
      <label className="approval-dialog-field" htmlFor="approval-send-back-reason">
        <span>Reason</span>
        <textarea
          aria-describedby={error ? "approval-send-back-error" : undefined}
          aria-invalid={error}
          disabled={pending}
          id="approval-send-back-reason"
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
        <p className="approval-dialog-error" id="approval-send-back-error" role="alert">
          Enter a reason between 1 and 500 characters.
        </p>
      ) : null}
      <DialogActions>
        <button disabled={pending} onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="is-danger" disabled={pending} onClick={submit} type="button">
          {pending ? "Sending..." : "Send back"}
        </button>
      </DialogActions>
    </DialogFrame>
  );
}

function OverrideDialog({
  item,
  onCancel,
  onSubmit,
  pending,
}: {
  item: Submission;
  onCancel(): void;
  onSubmit(input: ApproveWithOverrideRequest): void;
  pending: boolean;
}) {
  const [values, setValues] = useState({
    brokerFee: "",
    commissionAmount: "",
    netDue: "",
    reason: "",
  });
  const [error, setError] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => firstRef.current?.focus());
  }, []);
  const submit = () => {
    const parsed = buildApprovalOverrideInput(values);
    if (!parsed.success) {
      setError(true);
      return;
    }
    onSubmit(parsed.input);
  };
  const update = (field: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setError(false);
  };
  return (
    <DialogFrame
      onCancel={onCancel}
      pending={pending}
      title={`Approve ${submissionName(item)} with override`}
      wide
    >
      <fieldset className="approval-dialog-fieldset" disabled={pending}>
      <div className="approval-override-grid">
        <MoneyInput
          inputRef={firstRef}
          label="Commission amount"
          onChange={(value) => update("commissionAmount", value)}
          placeholder={String(item.entry.submittedPayload.commissionAmount ?? "")}
          value={values.commissionAmount}
        />
        <MoneyInput
          label="Broker fee"
          onChange={(value) => update("brokerFee", value)}
          placeholder={String(item.entry.submittedPayload.brokerFee ?? "")}
          value={values.brokerFee}
        />
        <MoneyInput
          label="Net due to MGA"
          onChange={(value) => update("netDue", value)}
          placeholder={String(item.entry.submittedPayload.netDue ?? "")}
          value={values.netDue}
        />
      </div>
      <label className="approval-dialog-field" htmlFor="approval-override-reason">
        <span>Reason</span>
        <textarea
          aria-invalid={error}
          disabled={pending}
          id="approval-override-reason"
          maxLength={2000}
          onChange={(event) => update("reason", event.currentTarget.value)}
          rows={3}
          value={values.reason}
        />
      </label>
      {error ? (
        <p className="approval-dialog-error" role="alert">
          Enter at least one valid changed amount and a written reason.
        </p>
      ) : null}
      </fieldset>
      <DialogActions>
        <button disabled={pending} onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="is-override" disabled={pending} onClick={submit} type="button">
          {pending ? "Applying..." : "Approve with override"}
        </button>
      </DialogActions>
    </DialogFrame>
  );
}

function OpenFixDialog({
  draft,
  onCancel,
  onSubmit,
  pending,
}: {
  draft: DraftResponse;
  onCancel(): void;
  onSubmit(input: UpdateDraftRequest): void;
  pending: boolean;
}) {
  const vocabulary = useVocabulary();
  const [form, setForm] = useState<TurnInFormState>(() =>
    turnInStateFromDraft(draft),
  );
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => firstRef.current?.focus());
  }, []);
  const options =
    vocabulary.state.status === "ready" ? vocabulary.state.data : null;
  const change = <Key extends keyof TurnInFormState>(
    field: Key,
    value: TurnInFormState[Key],
  ) => {
    setForm((current) => updateTurnInField(current, field, value));
    setError(null);
  };
  const submit = () => {
    const errors = validateTurnInForSubmit(form);
    const firstError = Object.values(errors)[0];
    if (firstError !== undefined) {
      setError(firstError);
      return;
    }
    onSubmit(turnInFormToDraftInput(form));
  };

  return (
    <DialogFrame
      onCancel={onCancel}
      pending={pending}
      title={`Open and fix ${draft.insuredName ?? "flagged turn-in"}`}
      wide
    >
      {error === null ? null : (
        <p className="approval-dialog-error" role="alert">{error}</p>
      )}
      <fieldset className="approval-dialog-fieldset" disabled={pending}>
      <div className="approval-fix-scroll">
        <DialogSection title="Policy">
          <div className="approval-fix-grid">
            <TextInput inputRef={firstRef} label="Insured" onChange={(value) => change("insuredName", value)} value={form.insuredName} />
            <TextInput label="Company" onChange={(value) => change("companyName", value)} value={form.companyName} />
            <TextInput label="Policy number" onChange={(value) => change("policyNumber", value)} value={form.policyNumber} />
            <TextInput label="Transaction" onChange={(value) => change("transactionType", value)} value={form.transactionType} />
            <TextInput label="Invoice number" onChange={(value) => change("invoiceNumber", value)} value={form.invoiceNumber} />
            <DateInput label="Effective" onChange={(value) => change("effectiveDate", value)} value={form.effectiveDate} />
            <DateInput label="Expiration" onChange={(value) => change("expirationDate", value)} value={form.expirationDate} />
            <SelectInput label="Policy type" onChange={(value) => change("policyTypeId", value || null)} options={options?.policyTypes ?? []} value={form.policyTypeId ?? ""} />
            <SelectInput label="Carrier" onChange={(value) => change("carrierId", value || null)} options={options?.carriers ?? []} value={form.carrierId ?? ""} />
            <SelectInput label="MGA" onChange={(value) => change("mgaId", value || null)} options={options?.mgas ?? []} value={form.mgaId ?? ""} />
            <SelectInput label="Office" onChange={(value) => change("officeLocationId", value || null)} options={options?.officeLocations ?? []} value={form.officeLocationId ?? ""} />
            <label className="approval-dialog-field"><span>Assignment</span><output>{assignmentText(form)}</output></label>
          </div>
          <TextAreaInput label="Transaction notes" onChange={(value) => change("transactionNotes", value)} value={form.transactionNotes} />
          <TextAreaInput label="General notes" onChange={(value) => change("notes", value)} value={form.notes} />
        </DialogSection>

        <DialogSection title="Premium and commission">
          <div className="approval-fix-grid">
            <MoneyInput label="Base premium" onChange={(value) => change("basePremium", value)} value={form.basePremium} />
            <MoneyInput label="Taxes" onChange={(value) => change("taxes", value)} value={form.taxes} />
            <MoneyInput label="MGA fee" onChange={(value) => change("mgaFee", value)} value={form.mgaFee} />
            <MoneyInput label="Broker fee" onChange={(value) => change("brokerFee", value)} value={form.brokerFee} />
            <MoneyInput label="Proposal total" onChange={(value) => change("proposalTotal", value)} value={form.proposalTotal} />
            <MoneyInput label="Amount collected" onChange={(value) => change("amountPaid", value)} value={form.amountPaid} />
            <label className="approval-dialog-field"><span>Commission mode</span><select disabled={pending} onChange={(event) => change("commissionMode", event.currentTarget.value as TurnInFormState["commissionMode"])} value={form.commissionMode}><option value="pct">Percentage</option><option value="tbd">TBD</option><option value="na">N/A</option></select></label>
            {form.commissionMode === "pct" ? <TextInput label="Commission rate %" onChange={(value) => change("commissionRate", value)} value={form.commissionRate} /> : null}
            <label className="approval-dialog-check"><input checked={form.commissionConfirmed} disabled={pending || form.commissionMode !== "pct"} onChange={(event) => change("commissionConfirmed", event.currentTarget.checked)} type="checkbox" /><span>Commission confirmed</span></label>
          </div>
        </DialogSection>

        <DialogSection title="Payment and financing">
          <div className="approval-fix-grid">
            <label className="approval-dialog-field"><span>Payment mode</span><select disabled={pending} onChange={(event) => change("paymentMode", event.currentTarget.value as TurnInFormState["paymentMode"])} value={form.paymentMode}><option value="full">Paid in full</option><option value="deposit">Deposit</option><option value="direct">Direct bill</option></select></label>
            <MoneyInput label="Deposit" onChange={(value) => change("depositOption", value)} value={form.depositOption} />
            <TextInput label="Finance reference" onChange={(value) => change("financeReference", value)} value={form.financeReference} />
            <label className="approval-dialog-field"><span>IPFS financed</span><select disabled={pending} onChange={(event) => change("ipfsFinanced", event.currentTarget.value as TurnInFormState["ipfsFinanced"])} value={form.ipfsFinanced}><option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="approval-dialog-field"><span>IPFS customer</span><select disabled={pending} onChange={(event) => change("ipfsReturning", event.currentTarget.value as TurnInFormState["ipfsReturning"])} value={form.ipfsReturning}><option value="">Not set</option><option value="new">New</option><option value="returning">Returning</option></select></label>
            <label className="approval-dialog-check"><input checked={form.ipfsManual} disabled={pending} onChange={(event) => change("ipfsManual", event.currentTarget.checked)} type="checkbox" /><span>Manual IPFS entry</span></label>
            <TextInput label="Finance email" onChange={(value) => change("financeEmail", value)} value={form.financeEmail} />
            <TextInput label="Finance mobile" onChange={(value) => change("financeMobile", value)} value={form.financeMobile} />
            <TextInput label="Finance address" onChange={(value) => change("financeAddress", value)} value={form.financeAddress} />
          </div>
        </DialogSection>
      </div>
      </fieldset>
      <DialogActions>
        <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
        <button className="is-primary" disabled={pending} onClick={submit} type="button">
          {pending ? "Approving..." : "Approve corrected policy"}
        </button>
      </DialogActions>
    </DialogFrame>
  );
}

export function DialogFrame({ children, onCancel, pending, title, wide = false }: {
  children: React.ReactNode;
  onCancel(): void;
  pending: boolean;
  title: string;
  wide?: boolean;
}) {
  return (
    <div className="approval-dialog-backdrop" role="presentation">
      <section aria-labelledby="approval-dialog-title" aria-modal="true" className={`approval-dialog${wide ? " is-wide" : ""}`} role="dialog">
        <header><h2 id="approval-dialog-title">{title}</h2><button aria-label="Close dialog" disabled={pending} onClick={onCancel} type="button">×</button></header>
        {children}
      </section>
    </div>
  );
}

export function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="approval-dialog-actions">{children}</div>;
}

function DialogSection({ children, title }: { children: React.ReactNode; title: string }) {
  return <section className="approval-fix-section"><h3>{title}</h3>{children}</section>;
}

function MoneyInput({ inputRef, label, onChange, placeholder, value }: {
  inputRef?: React.RefObject<HTMLInputElement>;
  label: string;
  onChange(value: string): void;
  placeholder?: string;
  value: string;
}) {
  return <label className="approval-dialog-field"><span>{label}</span><input inputMode="decimal" onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder} ref={inputRef} value={value} /></label>;
}

function TextInput({ inputRef, label, onChange, value }: { inputRef?: React.RefObject<HTMLInputElement>; label: string; onChange(value: string): void; value: string }) {
  return <label className="approval-dialog-field"><span>{label}</span><input onChange={(event) => onChange(event.currentTarget.value)} ref={inputRef} value={value} /></label>;
}

function DateInput({ label, onChange, value }: { label: string; onChange(value: string): void; value: string }) {
  return <label className="approval-dialog-field"><span>{label}</span><input onChange={(event) => onChange(event.currentTarget.value)} type="date" value={value} /></label>;
}

function TextAreaInput({ label, onChange, value }: { label: string; onChange(value: string): void; value: string }) {
  return <label className="approval-dialog-field"><span>{label}</span><textarea onChange={(event) => onChange(event.currentTarget.value)} rows={2} value={value} /></label>;
}

function SelectInput({ label, onChange, options, value }: { label: string; onChange(value: string): void; options: readonly { id: string; name: string }[]; value: string }) {
  const hasValue = value === "" || options.some(({ id }) => id === value);
  return <label className="approval-dialog-field"><span>{label}</span><select onChange={(event) => onChange(event.currentTarget.value)} value={value}><option value="">Select</option>{!hasValue ? <option value={value}>{value}</option> : null}{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
}

function useDialogLifecycle(open: boolean, pending: boolean, onCancel: () => void) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onCancel();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const dialog = document.querySelector<HTMLElement>(".approval-dialog");
      const focusable = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]",
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
      requestAnimationFrame(() => previousFocus?.focus());
    };
  }, [onCancel, open, pending]);
}

function submissionName(item: Submission): string {
  return String(item.entry.submittedPayload.insuredName ?? "submission");
}

function helpName(item: HelpRequest): string {
  return item.draft.insuredName ?? "flagged turn-in";
}

function assignmentText(form: TurnInFormState): string {
  if (form.accountAssignment === "none") return "Sophia house account";
  return `${form.accountAssignment === "house" ? "First-year" : "Producer account"} · ${form.producerUserId ?? "No producer"}`;
}
