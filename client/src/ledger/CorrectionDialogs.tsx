import React, { useEffect, useRef, useState } from "react";
import { accountAssignmentLabel } from "../../../shared/account-assignment-labels.js";
import type { DraftAssignmentOption } from "../../../shared/draft-assignment-options.js";
import type { PolicyLedgerCorrectionRequest } from "../../../shared/policy-corrections.js";
import type { PolicyLedgerItem } from "../../../shared/policy-ledger.js";
import type { PolicyOverrideField } from "../../../shared/policy-overrides.js";
import { useVocabulary } from "../vocabulary/context.js";
import {
  GENERAL_EDITOR_GROUPS,
  buildGeneralCorrectionRequest,
  buildOverrideCorrectionRequest,
  policyCorrectionValues,
  type GeneralEditorField,
} from "./view-state.js";

export type LedgerCorrectionDialog = {
  item: PolicyLedgerItem;
  kind: "general" | "override";
};

export function PolicyCorrectionDialog({
  assignmentOptions,
  dialog,
  onCancel,
  onSubmit,
  pending,
}: {
  assignmentOptions: readonly DraftAssignmentOption[];
  dialog: LedgerCorrectionDialog | null;
  onCancel(): void;
  onSubmit(input: PolicyLedgerCorrectionRequest): void;
  pending: boolean;
}) {
  useDialogLifecycle(dialog !== null, pending, onCancel);
  if (dialog === null) return null;
  return dialog.kind === "general" ? (
    <GeneralCorrectionDialog
      assignmentOptions={assignmentOptions}
      item={dialog.item}
      onCancel={onCancel}
      onSubmit={onSubmit}
      pending={pending}
    />
  ) : (
    <OverrideCorrectionDialog
      item={dialog.item}
      onCancel={onCancel}
      onSubmit={onSubmit}
      pending={pending}
    />
  );
}

function GeneralCorrectionDialog({
  assignmentOptions,
  item,
  onCancel,
  onSubmit,
  pending,
}: {
  assignmentOptions: readonly DraftAssignmentOption[];
  item: PolicyLedgerItem;
  onCancel(): void;
  onSubmit(input: PolicyLedgerCorrectionRequest): void;
  pending: boolean;
}) {
  const [values, setValues] = useState(() =>
    policyCorrectionValues(item.policy),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);
  const vocabulary = useVocabulary();
  const submit = () => {
    const result = buildGeneralCorrectionRequest(item.policy, values, reason);
    if (!result.success) {
      setError(true);
      return;
    }
    onSubmit(result.input);
  };
  const change = (field: keyof typeof values, value: unknown) => {
    setValues((current) => ({ ...current, [field]: value }));
    setError(false);
  };
  return (
    <DialogFrame
      onCancel={onCancel}
      pending={pending}
      title={`Correct ${item.policy.insuredName}`}
      wide
    >
      <fieldset className="ledger-correction-fieldset" disabled={pending}>
        <div className="ledger-correction-scroll">
          {GENERAL_EDITOR_GROUPS.map((group) => (
            <section className="ledger-correction-section" key={group.title}>
              <h3>{group.title}</h3>
              <div className="ledger-correction-grid">
                {group.fields.map((field) => (
                  <GeneralField
                    assignmentOptions={assignmentOptions}
                    field={field}
                    key={field.field}
                    onChange={(value) => change(field.field, value)}
                    producerDisplayName={
                      assignmentOptions.find(
                        ({ userId }) => userId === values.producerUserId,
                      )?.displayName ?? item.labels.producerDisplayName
                    }
                    value={values[field.field]}
                    vocabulary={
                      vocabulary.state.status === "ready"
                        ? vocabulary.state.data
                        : null
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        <ReasonField
          maxLength={500}
          onChange={(value) => {
            setReason(value);
            setError(false);
          }}
          value={reason}
        />
        {error ? (
          <p className="ledger-correction-error" role="alert">
            Review the changed fields and enter a reason.
          </p>
        ) : null}
      </fieldset>
      <DialogActions>
        <button disabled={pending} onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="is-primary"
          disabled={pending}
          onClick={submit}
          type="button"
        >
          {pending ? "Saving..." : "Save correction"}
        </button>
      </DialogActions>
    </DialogFrame>
  );
}

function OverrideCorrectionDialog({
  item,
  onCancel,
  onSubmit,
  pending,
}: {
  item: PolicyLedgerItem;
  onCancel(): void;
  onSubmit(input: PolicyLedgerCorrectionRequest): void;
  pending: boolean;
}) {
  const [values, setValues] = useState<Record<PolicyOverrideField, string>>({
    brokerFee: item.policy.brokerFee,
    commissionAmount: item.policy.commissionAmount,
    commissionMode: item.policy.commissionMode,
    netDue: item.policy.netDue,
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);
  const change = (field: PolicyOverrideField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setError(false);
  };
  const submit = () => {
    const result = buildOverrideCorrectionRequest(item.policy, values, reason);
    if (!result.success) {
      setError(true);
      return;
    }
    onSubmit(result.input);
  };
  return (
    <DialogFrame
      onCancel={onCancel}
      pending={pending}
      title={`Financial override for ${item.policy.insuredName}`}
    >
      <fieldset className="ledger-correction-fieldset" disabled={pending}>
        <div className="ledger-override-grid">
          <TextField label="Agency commission" onChange={(value) => change("commissionAmount", value)} value={values.commissionAmount} />
          <TextField label="Broker fee" onChange={(value) => change("brokerFee", value)} value={values.brokerFee} />
          <TextField label="Net due" onChange={(value) => change("netDue", value)} value={values.netDue} />
          <label className="ledger-dialog-field">
            <span>Commission mode</span>
            <select onChange={(event) => change("commissionMode", event.currentTarget.value)} value={values.commissionMode}>
              <option value="pct">Percentage</option>
              <option value="tbd">TBD</option>
              <option value="na">N/A</option>
            </select>
          </label>
        </div>
        <ReasonField
          maxLength={2_000}
          onChange={(value) => {
            setReason(value);
            setError(false);
          }}
          value={reason}
        />
        {error ? (
          <p className="ledger-correction-error" role="alert">
            Change at least one override value and enter a reason.
          </p>
        ) : null}
      </fieldset>
      <DialogActions>
        <button disabled={pending} onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="is-override"
          disabled={pending}
          onClick={submit}
          type="button"
        >
          {pending ? "Saving..." : "Apply financial override"}
        </button>
      </DialogActions>
    </DialogFrame>
  );
}

function GeneralField({
  assignmentOptions,
  field,
  onChange,
  producerDisplayName,
  value,
  vocabulary,
}: {
  assignmentOptions: readonly DraftAssignmentOption[];
  field: GeneralEditorField;
  onChange(value: unknown): void;
  producerDisplayName: string | null;
  value: unknown;
  vocabulary: {
    carriers: readonly { id: string; name: string }[];
    mgas: readonly { id: string; name: string }[];
    officeLocations: readonly { id: string; name: string }[];
    policyTypes: readonly { classTag: string; id: string; name: string }[];
  } | null;
}) {
  if (field.kind === "finance_contact") {
    const contact = isRecord(value) ? value : {};
    const update = (key: "address" | "email" | "mobile", next: string) => {
      const result = {
        address: stringValue(contact.address),
        email: stringValue(contact.email),
        mobile: stringValue(contact.mobile),
        [key]: next,
      };
      onChange(Object.values(result).every((entry) => entry === "") ? null : result);
    };
    return (
      <div className="ledger-dialog-field is-wide">
        <span>{field.label}</span>
        <div className="ledger-contact-grid">
          <input aria-label="Finance email" onChange={(event) => update("email", event.currentTarget.value)} placeholder="Email" type="email" value={stringValue(contact.email)} />
          <input aria-label="Finance mobile" onChange={(event) => update("mobile", event.currentTarget.value)} placeholder="Mobile" type="text" value={stringValue(contact.mobile)} />
          <input aria-label="Finance address" onChange={(event) => update("address", event.currentTarget.value)} placeholder="Address" type="text" value={stringValue(contact.address)} />
        </div>
      </div>
    );
  }
  if (field.kind === "finance_meta") {
    return (
      <SelectField
        label={field.label}
        onChange={(next) =>
          onChange(
            next === "standard"
              ? {
                  billingType: "invoice",
                  loanType: "commercial",
                  minEarnedAmt: null,
                  minEarnedPct: null,
                }
              : null,
          )
        }
        options={[
          { label: "Clear", value: "clear" },
          { label: "Standard IPFS metadata", value: "standard" },
        ]}
        value={value === null ? "clear" : "standard"}
      />
    );
  }
  if (field.kind === "boolean") {
    return (
      <SelectField
        label={field.label}
        onChange={(next) => onChange(next === "true")}
        options={[
          { label: "No", value: "false" },
          { label: "Yes", value: "true" },
        ]}
        value={value === true ? "true" : "false"}
      />
    );
  }
  if (field.kind === "assignment") {
    return (
      <SelectField
        label={field.label}
        onChange={onChange}
        options={[
          { label: accountAssignmentLabel("none", null), value: "none" },
          {
            label: accountAssignmentLabel("book", producerDisplayName),
            value: "book",
          },
          {
            label: accountAssignmentLabel("house", producerDisplayName),
            value: "house",
          },
        ]}
        value={stringValue(value)}
      />
    );
  }
  if (field.kind === "payment_mode") {
    return <SelectField label={field.label} onChange={onChange} options={[{ label: "Paid in full", value: "full" }, { label: "Deposit / financed", value: "deposit" }, { label: "Direct bill", value: "direct" }]} value={stringValue(value)} />;
  }
  if (field.kind === "ipfs_financed") {
    return <SelectField label={field.label} onChange={(next) => onChange(next === "" ? null : next)} options={[{ label: "Not set", value: "" }, { label: "No", value: "no" }, { label: "Yes", value: "yes" }]} value={value === null ? "" : stringValue(value)} />;
  }
  if (field.kind === "ipfs_customer") {
    return <SelectField label={field.label} onChange={(next) => onChange(next === "" ? null : next)} options={[{ label: "Not set", value: "" }, { label: "New", value: "new" }, { label: "Returning", value: "returning" }]} value={value === null ? "" : stringValue(value)} />;
  }
  if (field.kind === "producer") {
    return <SelectField label={field.label} onChange={(next) => onChange(next === "" ? null : next)} options={[{ label: "Unassigned", value: "" }, ...assignmentOptions.map(({ displayName, userId }) => ({ label: displayName, value: userId }))]} preserveValue value={value === null ? "" : stringValue(value)} />;
  }
  if (["carrier", "mga", "office", "policy_type"].includes(field.kind)) {
    const options =
      field.kind === "carrier"
        ? vocabulary?.carriers
        : field.kind === "mga"
          ? vocabulary?.mgas
          : field.kind === "office"
            ? vocabulary?.officeLocations
            : vocabulary?.policyTypes;
    return <SelectField label={field.label} onChange={onChange} options={(options ?? []).map(({ id, name }) => ({ label: name, value: id }))} preserveValue value={stringValue(value)} />;
  }
  if (field.kind === "textarea") {
    return (
      <label className="ledger-dialog-field is-wide">
        <span>{field.label}</span>
        <textarea onChange={(event) => onChange(nullableText(event.currentTarget.value, field.nullable))} rows={3} value={stringValue(value)} />
      </label>
    );
  }
  return (
    <label className="ledger-dialog-field">
      <span>{field.label}</span>
      <input
        inputMode={field.kind === "money" || field.kind === "rate" ? "decimal" : undefined}
        onChange={(event) => onChange(nullableText(event.currentTarget.value, field.nullable))}
        type={field.kind === "date" ? "date" : "text"}
        value={stringValue(value)}
      />
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  preserveValue = false,
  value,
}: {
  label: string;
  onChange(value: string): void;
  options: readonly { label: string; value: string }[];
  preserveValue?: boolean;
  value: string;
}) {
  const known = options.some((option) => option.value === value);
  return (
    <label className="ledger-dialog-field">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.currentTarget.value)} value={value}>
        {preserveValue && !known && value !== "" ? (
          <option value={value}>Current selection</option>
        ) : null}
        {options.map((option) => (
          <option key={`${option.value}:${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange(value: string): void;
  value: string;
}) {
  return (
    <label className="ledger-dialog-field">
      <span>{label}</span>
      <input inputMode="decimal" onChange={(event) => onChange(event.currentTarget.value)} value={value} />
    </label>
  );
}

function ReasonField({
  maxLength,
  onChange,
  value,
}: {
  maxLength: number;
  onChange(value: string): void;
  value: string;
}) {
  return (
    <label className="ledger-dialog-field ledger-correction-reason">
      <span>Reason</span>
      <textarea maxLength={maxLength} onChange={(event) => onChange(event.currentTarget.value)} rows={3} value={value} />
    </label>
  );
}

function DialogFrame({
  children,
  onCancel,
  pending,
  title,
  wide = false,
}: {
  children: React.ReactNode;
  onCancel(): void;
  pending: boolean;
  title: string;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => dialogRef.current?.focus());
  }, []);
  return (
    <div className="ledger-dialog-backdrop" role="presentation">
      <div
        aria-labelledby="ledger-correction-title"
        aria-modal="true"
        className={`ledger-dialog${wide ? " is-wide" : ""}`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <h2 id="ledger-correction-title">{title}</h2>
          <button aria-label="Close" disabled={pending} onClick={onCancel} title="Close" type="button">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="ledger-dialog-actions">{children}</div>;
}

function useDialogLifecycle(
  open: boolean,
  pending: boolean,
  onCancel: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open, pending]);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: string, nullable = false): string | null {
  return nullable && value === "" ? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
