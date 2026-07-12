import React from "react";
import type { PaySheetExportFormat } from "../../../shared/pay-sheet-export.js";
import type { PaySheetPeriodOption } from "./view-state.js";

export interface PaySheetExportAction {
  format: PaySheetExportFormat;
  scope: "all" | "owner";
}

export type PaySheetExportUiState =
  | { status: "idle" }
  | { message: string; status: "error" | "success" }
  | { action: PaySheetExportAction; status: "pending" };

export function PaySheetExportControls({
  activeOwnerAvailable,
  activeOwnerLabel,
  disabled,
  onAction,
  onPeriod,
  periods,
  selectedPeriodKey,
  state,
}: {
  activeOwnerAvailable: boolean;
  activeOwnerLabel: string;
  disabled: boolean;
  onAction(action: PaySheetExportAction): void;
  onPeriod(periodKey: string): void;
  periods: readonly PaySheetPeriodOption[];
  selectedPeriodKey: string;
  state: PaySheetExportUiState;
}) {
  const pending = state.status === "pending";
  return (
    <section className="pay-sheet-export-toolbar" aria-labelledby="pay-sheet-export-title">
      <header>
        <div>
          <p>Admin confidential</p>
          <h2 id="pay-sheet-export-title">Export & print</h2>
        </div>
        <label>
          <span>Report period</span>
          <select
            disabled={disabled || pending}
            onChange={(event) => onPeriod(event.currentTarget.value)}
            value={selectedPeriodKey}
          >
            {periods.map((period) => (
              <option key={period.key} value={period.key}>{period.label}</option>
            ))}
          </select>
        </label>
      </header>
      <div className="pay-sheet-export-scopes">
        <ExportScopeActions
          disabled={disabled || pending}
          label="Full agency"
          note="All owners"
          onAction={(format) => onAction({ format, scope: "all" })}
          pending={state.status === "pending" && state.action.scope === "all"}
        />
        <ExportScopeActions
          disabled={disabled || pending || !activeOwnerAvailable}
          label={activeOwnerLabel}
          note={activeOwnerAvailable ? "Selected owner" : "No sheet in this period"}
          onAction={(format) => onAction({ format, scope: "owner" })}
          pending={state.status === "pending" && state.action.scope === "owner"}
        />
      </div>
      {state.status === "idle" ? null : (
        <div
          className={`pay-sheet-export-status is-${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.status === "pending"
            ? `${state.action.format === "excel" ? "Preparing Excel" : "Preparing print view"}...`
            : state.message}
        </div>
      )}
    </section>
  );
}

export function PaySheetFullExportDialog({
  action,
  onCancel,
  onConfirm,
  pending,
  periodLabel,
}: {
  action: PaySheetExportAction | null;
  onCancel(): void;
  onConfirm(): void;
  pending: boolean;
  periodLabel: string;
}) {
  if (action === null || action.scope !== "all") return null;
  const excel = action.format === "excel";
  return (
    <div className="pay-sheet-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="pay-sheet-export-dialog-title"
        aria-modal="true"
        className="pay-sheet-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>Full agency / {periodLabel}</p>
            <h2 id="pay-sheet-export-dialog-title">
              {excel ? "Download agency workbook" : "Print agency report"}
            </h2>
          </div>
          <button aria-label="Close export confirmation" disabled={pending} onClick={onCancel} type="button">
            X
          </button>
        </header>
        <div className="pay-sheet-dialog-body">
          <p>
            This confidential report includes every owner with a pay sheet in
            {` ${periodLabel}`}.
          </p>
        </div>
        <footer className="pay-sheet-dialog-actions">
          <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
          <button className="is-primary" disabled={pending} onClick={onConfirm} type="button">
            {pending
              ? "Preparing..."
              : excel
                ? "Download Excel"
                : "Open print view"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ExportScopeActions({
  disabled,
  label,
  note,
  onAction,
  pending,
}: {
  disabled: boolean;
  label: string;
  note: string;
  onAction(format: PaySheetExportFormat): void;
  pending: boolean;
}) {
  return (
    <div className="pay-sheet-export-scope">
      <span>
        <strong>{label}</strong>
        <small>{note}</small>
      </span>
      <div>
        <button disabled={disabled} onClick={() => onAction("excel")} type="button">
          {pending ? "Working..." : "Excel"}
        </button>
        <button disabled={disabled} onClick={() => onAction("print")} type="button">
          {pending ? "Working..." : "Print"}
        </button>
      </div>
    </div>
  );
}
