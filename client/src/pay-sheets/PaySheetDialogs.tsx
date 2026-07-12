import React, { useMemo, useState, type FormEvent } from "react";
import type { DraftAssignmentOption } from "../../../shared/draft-assignment-options.js";
import {
  parsePaySheetAdjustmentForOwner,
  type PaySheetAdjustmentInput,
} from "../../../shared/pay-sheet-adjustment-api.js";
import type {
  PaySheetAdjustmentView,
  PaySheetDetail,
  PaySheetSummary,
} from "../../../shared/pay-sheet-api.js";
import type { PolicyTypeOption } from "../../../shared/vocabulary.js";
import { formatMoneyExact } from "../ledger/view-state.js";
import {
  adjustmentTypeLabel,
  formatPaySheetPeriod,
  isDirectIncomeAdjustment,
} from "./view-state.js";

export type PaySheetAdjustmentDialogState =
  | {
      kind: "create";
      mode: "correction" | "direct_income";
      sheet: PaySheetDetail;
    }
  | {
      adjustment: PaySheetAdjustmentView;
      kind: "delete";
      sheet: PaySheetDetail;
    }
  | {
      adjustment: PaySheetAdjustmentView;
      kind: "edit";
      sheet: PaySheetDetail;
    };

export function PaySheetCloseDialog({
  error,
  onCancel,
  onConfirm,
  pending,
  sheet,
}: {
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
  pending: boolean;
  sheet: PaySheetSummary | null;
}) {
  if (sheet === null) return null;
  return (
    <div className="pay-sheet-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="pay-sheet-close-title"
        aria-modal="true"
        className="pay-sheet-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>Finalize period</p>
            <h2 id="pay-sheet-close-title">
              Close {formatPaySheetPeriod(sheet.periodMonth, sheet.periodYear)}?
            </h2>
          </div>
          <button
            aria-label="Close dialog"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            X
          </button>
        </header>
        <div className="pay-sheet-dialog-body">
          <p>
            This freezes policy, rate, adjustment, and total history. A closed
            sheet cannot be reopened; later corrections belong on the next
            open sheet.
          </p>
          <dl className="pay-sheet-close-summary">
            <div>
              <dt>Owner</dt>
              <dd>{sheet.ownerDisplayName}</dd>
            </div>
            <div>
              <dt>Policies</dt>
              <dd>{sheet.policyCount}</dd>
            </div>
            <div>
              <dt>Adjustments</dt>
              <dd>{sheet.adjustmentCount}</dd>
            </div>
          </dl>
          {error === null ? null : (
            <div className="pay-sheet-dialog-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="pay-sheet-dialog-actions">
          <button disabled={pending} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="is-danger"
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {pending ? "Closing..." : "Close sheet"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function PaySheetAdjustmentDialog({
  dialog,
  error,
  onCancel,
  onDelete,
  onSubmit,
  pending,
  policyTypes,
  producers,
}: {
  dialog: PaySheetAdjustmentDialogState | null;
  error: string | null;
  onCancel(): void;
  onDelete(): void;
  onSubmit(input: PaySheetAdjustmentInput): void;
  pending: boolean;
  policyTypes: readonly PolicyTypeOption[];
  producers: readonly DraftAssignmentOption[];
}) {
  if (dialog === null) return null;
  if (dialog.kind === "delete") {
    return (
      <DeleteAdjustmentDialog
        adjustment={dialog.adjustment}
        error={error}
        onCancel={onCancel}
        onDelete={onDelete}
        pending={pending}
      />
    );
  }
  return (
    <AdjustmentFormDialog
      dialog={dialog}
      error={error}
      onCancel={onCancel}
      onSubmit={onSubmit}
      pending={pending}
      policyTypes={policyTypes}
      producers={producers}
    />
  );
}

function AdjustmentFormDialog({
  dialog,
  error,
  onCancel,
  onSubmit,
  pending,
  policyTypes,
  producers,
}: {
  dialog: Exclude<PaySheetAdjustmentDialogState, { kind: "delete" }>;
  error: string | null;
  onCancel(): void;
  onSubmit(input: PaySheetAdjustmentInput): void;
  pending: boolean;
  policyTypes: readonly PolicyTypeOption[];
  producers: readonly DraftAssignmentOption[];
}) {
  const initial = useMemo(() => initialForm(dialog), [dialog]);
  const [form, setForm] = useState(initial);
  const [validationError, setValidationError] = useState<string | null>(null);
  const directIncome = isDirectIncomeAdjustment(form.adjustmentType);
  const producerSheet = dialog.sheet.ownerType === "producer";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);
    try {
      const input = parsePaySheetAdjustmentForOwner(
        {
          accountBasis: form.accountBasis,
          adjustmentType: form.adjustmentType,
          brokerFeeDelta: directIncome ? "0.00" : form.brokerFeeDelta,
          commissionDelta: directIncome ? "0.00" : form.commissionDelta,
          effectiveDate: form.effectiveDate,
          incomeAmount: directIncome ? form.incomeAmount : "0.00",
          insuredOrClientLabel: form.insuredOrClientLabel,
          payoutDelta: producerSheet ? form.payoutDelta : "0.00",
          policyTypeId: directIncome ? null : form.policyTypeId,
          producerUserId:
            directIncome || form.accountBasis === "own"
              ? null
              : form.producerUserId,
          reasonOrNote: form.reasonOrNote === "" ? null : form.reasonOrNote,
        },
        dialog.sheet.ownerType,
      );
      onSubmit(input);
    } catch {
      setValidationError(
        directIncome
          ? "Enter a positive income amount and complete the required fields."
          : "Enter at least one valid negative adjustment and complete the required fields.",
      );
    }
  };

  return (
    <div className="pay-sheet-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="pay-sheet-adjustment-title"
        aria-modal="true"
        className="pay-sheet-dialog is-wide"
        role="dialog"
      >
        <header>
          <div>
            <p>{dialog.sheet.ownerDisplayName}</p>
            <h2 id="pay-sheet-adjustment-title">
              {dialog.kind === "edit"
                ? "Edit adjustment"
                : directIncome
                  ? "Add direct income"
                  : "Add correction"}
            </h2>
          </div>
          <button
            aria-label="Close dialog"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            X
          </button>
        </header>
        <form onSubmit={submit}>
          <fieldset className="pay-sheet-adjustment-fieldset" disabled={pending}>
            <div className="pay-sheet-adjustment-grid">
              <label className="pay-sheet-dialog-field">
                <span>Entry type</span>
                <select
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      adjustmentType: event.currentTarget.value as typeof current.adjustmentType,
                    }))
                  }
                  value={form.adjustmentType}
                >
                  {(directIncome
                    ? ["direct_deposit", "check_income", "ach_income"]
                    : ["chargeback", "manual_adjustment"]
                  ).map((value) => (
                    <option key={value} value={value}>
                      {adjustmentTypeLabel(value as typeof form.adjustmentType)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pay-sheet-dialog-field">
                <span>Effective date</span>
                <input
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      effectiveDate: event.currentTarget.value,
                    }))
                  }
                  required
                  type="date"
                  value={form.effectiveDate}
                />
              </label>
              <label className="pay-sheet-dialog-field is-wide">
                <span>Insured or client</span>
                <input
                  maxLength={500}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      insuredOrClientLabel: event.currentTarget.value,
                    }))
                  }
                  required
                  value={form.insuredOrClientLabel}
                />
              </label>

              {directIncome ? (
                <label className="pay-sheet-dialog-field">
                  <span>Income amount</span>
                  <input
                    inputMode="decimal"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        incomeAmount: event.currentTarget.value,
                      }))
                    }
                    placeholder="0.00"
                    required
                    value={form.incomeAmount}
                  />
                </label>
              ) : (
                <>
                  <label className="pay-sheet-dialog-field">
                    <span>Account classification</span>
                    <select
                      onChange={(event) => {
                        const accountBasis = event.currentTarget.value as typeof form.accountBasis;
                        setForm((current) => ({
                          ...current,
                          accountBasis,
                          producerUserId:
                            accountBasis === "own"
                              ? null
                              : current.producerUserId ??
                                producers[0]?.userId ??
                                dialog.sheet.ownerUserId,
                        }));
                      }}
                      value={form.accountBasis}
                    >
                      {producerSheet ? null : <option value="own">Sophia own account</option>}
                      <option value="book">Producer account</option>
                      <option value="house">Producer first year</option>
                    </select>
                  </label>
                  {form.accountBasis === "own" ? null : (
                    <label className="pay-sheet-dialog-field">
                      <span>Producer</span>
                      <select
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            producerUserId: event.currentTarget.value,
                          }))
                        }
                        required
                        value={form.producerUserId ?? ""}
                      >
                        {producers.map((producer) => (
                          <option key={producer.userId} value={producer.userId}>
                            {producer.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="pay-sheet-dialog-field">
                    <span>Policy type (optional)</span>
                    <select
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          policyTypeId: event.currentTarget.value || null,
                        }))
                      }
                      value={form.policyTypeId ?? ""}
                    >
                      <option value="">Not specified</option>
                      {policyTypes.map((policyType) => (
                        <option key={policyType.id} value={policyType.id}>
                          {policyType.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {producerSheet ? (
                    <MoneyField
                      label="Payout delta (negative)"
                      onChange={(payoutDelta) =>
                        setForm((current) => ({ ...current, payoutDelta }))
                      }
                      value={form.payoutDelta}
                    />
                  ) : (
                    <>
                      <MoneyField
                        label="Broker fee delta (negative)"
                        onChange={(brokerFeeDelta) =>
                          setForm((current) => ({ ...current, brokerFeeDelta }))
                        }
                        value={form.brokerFeeDelta}
                      />
                      <MoneyField
                        label="Commission delta (negative)"
                        onChange={(commissionDelta) =>
                          setForm((current) => ({ ...current, commissionDelta }))
                        }
                        value={form.commissionDelta}
                      />
                    </>
                  )}
                </>
              )}

              <label className="pay-sheet-dialog-field is-wide">
                <span>Note (optional)</span>
                <textarea
                  maxLength={2000}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reasonOrNote: event.currentTarget.value,
                    }))
                  }
                  rows={3}
                  value={form.reasonOrNote}
                />
              </label>
            </div>
          </fieldset>
          {validationError === null && error === null ? null : (
            <div className="pay-sheet-dialog-error" role="alert">
              {validationError ?? error}
            </div>
          )}
          <footer className="pay-sheet-dialog-actions">
            <button disabled={pending} onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="is-primary" disabled={pending} type="submit">
              {pending
                ? "Saving..."
                : dialog.kind === "edit"
                  ? "Save adjustment"
                  : "Add entry"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DeleteAdjustmentDialog({
  adjustment,
  error,
  onCancel,
  onDelete,
  pending,
}: {
  adjustment: PaySheetAdjustmentView;
  error: string | null;
  onCancel(): void;
  onDelete(): void;
  pending: boolean;
}) {
  return (
    <div className="pay-sheet-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="pay-sheet-delete-title"
        aria-modal="true"
        className="pay-sheet-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>{adjustmentTypeLabel(adjustment.adjustmentType)}</p>
            <h2 id="pay-sheet-delete-title">Delete adjustment?</h2>
          </div>
        </header>
        <div className="pay-sheet-dialog-body">
          <p>
            Remove {adjustment.insuredOrClientLabel} from this open pay sheet.
          </p>
          <strong>{adjustmentDisplayAmount(adjustment)}</strong>
          {error === null ? null : (
            <div className="pay-sheet-dialog-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="pay-sheet-dialog-actions">
          <button disabled={pending} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="is-danger"
            disabled={pending}
            onClick={onDelete}
            type="button"
          >
            {pending ? "Deleting..." : "Delete"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MoneyField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange(value: string): void;
  value: string;
}) {
  return (
    <label className="pay-sheet-dialog-field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="-0.00"
        required
        value={value}
      />
    </label>
  );
}

interface AdjustmentFormState {
  accountBasis: PaySheetAdjustmentInput["accountBasis"];
  adjustmentType: PaySheetAdjustmentInput["adjustmentType"];
  brokerFeeDelta: string;
  commissionDelta: string;
  effectiveDate: string;
  incomeAmount: string;
  insuredOrClientLabel: string;
  payoutDelta: string;
  policyTypeId: string | null;
  producerUserId: string | null;
  reasonOrNote: string;
}

function initialForm(
  dialog: Exclude<PaySheetAdjustmentDialogState, { kind: "delete" }>,
): AdjustmentFormState {
  if (dialog.kind === "edit") {
    const adjustment = dialog.adjustment;
    return {
      accountBasis: adjustment.accountBasis,
      adjustmentType: adjustment.adjustmentType,
      brokerFeeDelta: adjustment.brokerFeeDelta,
      commissionDelta: adjustment.commissionDelta,
      effectiveDate: adjustment.effectiveDate,
      incomeAmount: adjustment.incomeAmount,
      insuredOrClientLabel: adjustment.insuredOrClientLabel,
      payoutDelta: adjustment.payoutDelta,
      policyTypeId: adjustment.policyTypeId,
      producerUserId: adjustment.producerUserId,
      reasonOrNote: adjustment.reasonOrNote ?? "",
    };
  }
  const producerSheet = dialog.sheet.ownerType === "producer";
  return {
    accountBasis: producerSheet ? "book" : "own",
    adjustmentType:
      dialog.mode === "direct_income" ? "check_income" : "chargeback",
    brokerFeeDelta: "0.00",
    commissionDelta: "0.00",
    effectiveDate: new Date().toISOString().slice(0, 10),
    incomeAmount: "0.00",
    insuredOrClientLabel: "",
    payoutDelta: "0.00",
    policyTypeId: null,
    producerUserId: producerSheet ? dialog.sheet.ownerUserId : null,
    reasonOrNote: "",
  };
}

function adjustmentDisplayAmount(adjustment: PaySheetAdjustmentView): string {
  if (isDirectIncomeAdjustment(adjustment.adjustmentType)) {
    return formatMoneyExact(adjustment.incomeAmount);
  }
  if (adjustment.payoutDelta !== "0.00") {
    return formatMoneyExact(adjustment.payoutDelta);
  }
  const values = [adjustment.brokerFeeDelta, adjustment.commissionDelta].filter(
    (value) => value !== "0.00",
  );
  return values.map(formatMoneyExact).join(" / ");
}
