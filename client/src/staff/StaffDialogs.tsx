import React, {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  createAdminStaffRequestSchema,
  producerRateInputSchema,
  updateAdminStaffRequestSchema,
  type AdminStaffRate,
  type AdminStaffRecord,
  type CreateAdminStaffRequest,
  type ProducerRateInput,
  type UpdateAdminStaffRequest,
} from "../../../shared/admin-staff.js";
import { PASSWORD_REQUIREMENTS } from "../../../shared/password-policy.js";
import { staffRoleLabel } from "./view-state.js";

export type StaffDialogState =
  | { kind: "create" }
  | { kind: "edit"; staff: AdminStaffRecord };

export type RateDialogState =
  | { kind: "create"; staff: AdminStaffRecord }
  | { kind: "edit"; rate: AdminStaffRate; staff: AdminStaffRecord };

export interface ActiveDialogState {
  active: boolean;
  staff: AdminStaffRecord;
}

interface StaffFormValues {
  displayName: string;
  email: string;
  role: AdminStaffRecord["role"];
  temporaryPassword: string;
}

const EMPTY_RATE: ProducerRateInput = {
  effectiveDate: "",
  newBrokerRate: "0.00",
  newCommissionRate: "0.00",
  renewalBrokerRate: "0.00",
  renewalCommissionRate: "0.00",
};

export function StaffEditorDialog({
  dialog,
  error,
  onCancel,
  onCreate,
  onUpdate,
  pending,
}: {
  dialog: StaffDialogState | null;
  error: string | null;
  onCancel(): void;
  onCreate(input: CreateAdminStaffRequest): void;
  onUpdate(userId: string, input: UpdateAdminStaffRequest): void;
  pending: boolean;
}) {
  const staff = dialog?.kind === "edit" ? dialog.staff : null;
  const [values, setValues] = useState<StaffFormValues>(() =>
    initialStaffValues(staff),
  );
  const [initialRate, setInitialRate] = useState<ProducerRateInput>(EMPTY_RATE);
  const [validationError, setValidationError] = useState<string | null>(null);
  const secretRef = useRef(values.temporaryPassword);

  useEffect(
    () => () => {
      secretRef.current = "";
    },
    [],
  );

  if (dialog === null) return null;

  const needsInitialRate =
    values.role === "producer" &&
    (dialog.kind === "create" ||
      (dialog.staff.role === "employee" && dialog.staff.rates.length === 0));
  const dormantOnSave =
    dialog.kind === "edit" &&
    dialog.staff.role === "producer" &&
    values.role === "employee" &&
    dialog.staff.rates.length > 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);
    const normalizedRate = normalizeRateInput(initialRate);
    if (dialog.kind === "create") {
      const parsed = createAdminStaffRequestSchema.safeParse({
        displayName: values.displayName,
        email: values.email,
        ...(needsInitialRate ? { initialRate: normalizedRate } : {}),
        role: values.role,
        temporaryPassword: values.temporaryPassword,
      });
      if (!parsed.success) {
        setValidationError(firstIssue(parsed.error));
        return;
      }
      clearTemporaryPassword();
      onCreate(parsed.data);
      return;
    }

    const input: Record<string, unknown> = {};
    if (values.displayName.trim() !== dialog.staff.displayName) {
      input.displayName = values.displayName;
    }
    if (values.email.trim().toLowerCase() !== dialog.staff.email) {
      input.email = values.email;
    }
    if (values.role !== dialog.staff.role) input.role = values.role;
    if (needsInitialRate) input.initialRate = normalizedRate;
    const parsed = updateAdminStaffRequestSchema.safeParse(input);
    if (!parsed.success) {
      setValidationError(
        Object.keys(input).length === 0
          ? "No profile changes to save."
          : firstIssue(parsed.error),
      );
      return;
    }
    onUpdate(dialog.staff.userId, parsed.data);
  };

  const clearTemporaryPassword = () => {
    secretRef.current = "";
    setValues((current) => ({ ...current, temporaryPassword: "" }));
  };

  return (
    <div className="staff-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="staff-editor-title"
        aria-modal="true"
        className="staff-dialog is-wide"
        role="dialog"
      >
        <header>
          <div>
            <p>Account management</p>
            <h2 id="staff-editor-title">
              {dialog.kind === "create" ? "Add staff account" : "Edit staff account"}
            </h2>
          </div>
          <button aria-label="Close staff editor" disabled={pending} onClick={onCancel} type="button">
            Close
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="staff-form-grid">
            <label className="staff-field">
              <span>Display name</span>
              <input
                autoComplete="off"
                disabled={pending}
                maxLength={200}
                onChange={(event) => {
                  const displayName = event.currentTarget.value;
                  setValues((current) => ({
                    ...current,
                    displayName,
                  }));
                }}
                required
                value={values.displayName}
              />
            </label>
            <label className="staff-field">
              <span>Email</span>
              <input
                autoComplete="off"
                disabled={pending}
                onChange={(event) => {
                  const email = event.currentTarget.value;
                  setValues((current) => ({
                    ...current,
                    email,
                  }));
                }}
                required
                type="email"
                value={values.email}
              />
            </label>
            <label className="staff-field">
              <span>Role</span>
              <select
                disabled={pending}
                onChange={(event) => {
                  const role = event.currentTarget.value as AdminStaffRecord["role"];
                  setValues((current) => ({
                    ...current,
                    role,
                  }));
                }}
                value={values.role}
              >
                <option value="employee">Employee</option>
                <option value="producer">Producer</option>
              </select>
            </label>
            {dialog.kind === "create" ? (
              <label className="staff-field is-wide">
                <span>Temporary password</span>
                <input
                  autoComplete="new-password"
                  disabled={pending}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    secretRef.current = value;
                    setValues((current) => ({
                      ...current,
                      temporaryPassword: value,
                    }));
                  }}
                  required
                  type="password"
                  value={values.temporaryPassword}
                />
                <small>{PASSWORD_REQUIREMENTS.map(({ label }) => label).join("; ")}.</small>
              </label>
            ) : null}
          </div>

          {needsInitialRate ? (
            <fieldset className="staff-rate-fieldset">
              <legend>Initial producer rate</legend>
              <p>Producer access requires an explicit rate. No default will be invented.</p>
              <RateFields disabled={pending} onChange={setInitialRate} value={initialRate} />
            </fieldset>
          ) : null}

          {dormantOnSave ? (
            <p className="staff-dialog-note">
              Existing producer rates will remain as dormant history and will not be deleted.
            </p>
          ) : null}

          {validationError !== null || error !== null ? (
            <p className="staff-dialog-error" role="alert">
              {validationError ?? error}
            </p>
          ) : null}
          <footer>
            <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
            <button className="is-primary" disabled={pending} type="submit">
              {pending
                ? "Saving..."
                : dialog.kind === "create"
                  ? "Create account"
                  : "Save changes"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function RateEditorDialog({
  dialog,
  error,
  onCancel,
  onCreate,
  onUpdate,
  pending,
}: {
  dialog: RateDialogState | null;
  error: string | null;
  onCancel(): void;
  onCreate(userId: string, input: ProducerRateInput): void;
  onUpdate(userId: string, rateId: string, input: ProducerRateInput): void;
  pending: boolean;
}) {
  const [value, setValue] = useState<ProducerRateInput>(() =>
    dialog?.kind === "edit" ? rateInput(dialog.rate) : EMPTY_RATE,
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  if (dialog === null) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = producerRateInputSchema.safeParse(normalizeRateInput(value));
    if (!parsed.success) {
      setValidationError(firstIssue(parsed.error));
      return;
    }
    setValidationError(null);
    if (dialog.kind === "create") {
      onCreate(dialog.staff.userId, parsed.data);
    } else {
      onUpdate(dialog.staff.userId, dialog.rate.id, parsed.data);
    }
  };

  return (
    <div className="staff-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="staff-rate-title"
        aria-modal="true"
        className="staff-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>{dialog.staff.displayName}</p>
            <h2 id="staff-rate-title">
              {dialog.kind === "create" ? "Add producer rate" : "Correct rate history"}
            </h2>
          </div>
          <button aria-label="Close rate editor" disabled={pending} onClick={onCancel} type="button">
            Close
          </button>
        </header>
        <form onSubmit={submit}>
          {dialog.kind === "edit" ? (
            <p className="staff-dialog-note">
              Confirm this fresh correction carefully. Once a pay sheet snapshots this rate, it becomes immutable.
            </p>
          ) : null}
          <RateFields disabled={pending} onChange={setValue} value={value} />
          {validationError !== null || error !== null ? (
            <p className="staff-dialog-error" role="alert">
              {validationError ?? error}
            </p>
          ) : null}
          <footer>
            <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
            <button className="is-primary" disabled={pending} type="submit">
              {pending
                ? "Saving..."
                : dialog.kind === "create"
                  ? "Add rate"
                  : "Confirm correction"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function StaffActiveDialog({
  dialog,
  error,
  onCancel,
  onConfirm,
  pending,
}: {
  dialog: ActiveDialogState | null;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
  pending: boolean;
}) {
  if (dialog === null) return null;
  const action = dialog.active ? "Reactivate" : "Deactivate";
  return (
    <div className="staff-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="staff-active-title"
        aria-modal="true"
        className="staff-dialog is-confirmation"
        role="dialog"
      >
        <header>
          <div>
            <p>{staffRoleLabel(dialog.staff.role)}</p>
            <h2 id="staff-active-title">{action} {dialog.staff.displayName}?</h2>
          </div>
        </header>
        <p className="staff-dialog-copy">
          {dialog.active
            ? "This restores account access. Historical records and rate history remain unchanged."
            : "This ends active sessions and blocks future sign-in. Policy, rate, audit, and pay-sheet history will be retained."}
        </p>
        {error !== null ? <p className="staff-dialog-error" role="alert">{error}</p> : null}
        <footer>
          <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
          <button
            className={dialog.active ? "is-primary" : "is-danger"}
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {pending ? "Saving..." : action}
          </button>
        </footer>
      </section>
    </div>
  );
}

function RateFields({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange(value: ProducerRateInput): void;
  value: ProducerRateInput;
}) {
  return (
    <div className="staff-rate-grid">
      <label className="staff-field">
        <span>Effective date</span>
        <input
          disabled={disabled}
          onChange={(event) => onChange({ ...value, effectiveDate: event.currentTarget.value })}
          required
          type="date"
          value={value.effectiveDate}
        />
      </label>
      <RateInput disabled={disabled} label="New commission" name="newCommissionRate" onChange={onChange} value={value} />
      <RateInput disabled={disabled} label="New broker" name="newBrokerRate" onChange={onChange} value={value} />
      <RateInput disabled={disabled} label="Renewal commission" name="renewalCommissionRate" onChange={onChange} value={value} />
      <RateInput disabled={disabled} label="Renewal broker" name="renewalBrokerRate" onChange={onChange} value={value} />
    </div>
  );
}

function RateInput({
  disabled,
  label,
  name,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  name: Exclude<keyof ProducerRateInput, "effectiveDate">;
  onChange(value: ProducerRateInput): void;
  value: ProducerRateInput;
}) {
  return (
    <label className="staff-field">
      <span>{label} (%)</span>
      <input
        disabled={disabled}
        inputMode="decimal"
        max="100"
        min="0"
        onChange={(event) => onChange({ ...value, [name]: event.currentTarget.value })}
        required
        step="0.01"
        type="number"
        value={value[name]}
      />
    </label>
  );
}

function initialStaffValues(staff: AdminStaffRecord | null): StaffFormValues {
  return {
    displayName: staff?.displayName ?? "",
    email: staff?.email ?? "",
    role: staff?.role ?? "employee",
    temporaryPassword: "",
  };
}

function rateInput(rate: AdminStaffRate): ProducerRateInput {
  return {
    effectiveDate: rate.effectiveDate,
    newBrokerRate: rate.newBrokerRate,
    newCommissionRate: rate.newCommissionRate,
    renewalBrokerRate: rate.renewalBrokerRate,
    renewalCommissionRate: rate.renewalCommissionRate,
  };
}

function normalizeRateInput(value: ProducerRateInput): ProducerRateInput {
  return {
    effectiveDate: value.effectiveDate,
    newBrokerRate: normalizeRate(value.newBrokerRate),
    newCommissionRate: normalizeRate(value.newCommissionRate),
    renewalBrokerRate: normalizeRate(value.renewalBrokerRate),
    renewalCommissionRate: normalizeRate(value.renewalCommissionRate),
  };
}

function normalizeRate(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value;
}

function firstIssue(error: { issues: readonly { message: string }[] }): string {
  return error.issues[0]?.message ?? "Review the highlighted values.";
}
