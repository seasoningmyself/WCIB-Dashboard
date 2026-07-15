import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BUSINESS_STATE_RESET_CONFIRMATION,
  BUSINESS_STATE_RESTORE_CONFIRMATION_PREFIX,
  type BusinessStateGeneration,
  type BusinessStateListResponse,
} from "../../../shared/business-state.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { BusinessStateApiError, createBusinessStateApi } from "./api.js";

type ViewState =
  | { status: "denied" | "error" | "loading" }
  | ({ status: "ready" } & BusinessStateListResponse);

export type TransitionDialog =
  | { clearKpiTargets: boolean; confirmation: string; kind: "reset" }
  | {
      confirmation: string;
      generation: BusinessStateGeneration;
      kind: "restore";
    };

export function BusinessStateSettings() {
  const client = useApiClient();
  const api = useMemo(() => createBusinessStateApi(client), [client]);
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [dialog, setDialog] = useState<TransitionDialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setState({ ...(await api.list()), status: "ready" });
    } catch (caught) {
      setState({
        status:
          caught instanceof BusinessStateApiError && caught.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const clear = useCallback(() => {
    setState({ status: "loading" });
    setDialog(null);
    setError(null);
    setNotice(null);
    setPending(false);
  }, []);
  useSensitiveSessionCleanup(clear);

  const submit = async () => {
    if (dialog === null || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (dialog.kind === "reset") {
        await api.reset({
          clearKpiTargets: dialog.clearKpiTargets,
          confirmation: dialog.confirmation as typeof BUSINESS_STATE_RESET_CONFIRMATION,
        });
        setNotice("A new business-data generation is active. The prior state is sealed for recovery.");
      } else {
        await api.restore(dialog.generation.id, {
          confirmation: dialog.confirmation,
        });
        setNotice(`Recovery point ${dialog.generation.code} is active again.`);
      }
      setDialog(null);
      await load();
    } catch (caught) {
      setError(transitionError(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <BusinessStateSettingsView
        notice={notice}
        onReset={() => {
          setError(null);
          setDialog({ clearKpiTargets: false, confirmation: "", kind: "reset" });
        }}
        onRestore={(generation) => {
          setError(null);
          setDialog({ confirmation: "", generation, kind: "restore" });
        }}
        onRetry={() => void load()}
        pending={pending}
        state={state}
      />
      <BusinessStateDialog
        dialog={dialog}
        error={error}
        onCancel={() => {
          if (!pending) {
            setDialog(null);
            setError(null);
          }
        }}
        onChange={setDialog}
        onSubmit={() => void submit()}
        pending={pending}
      />
    </>
  );
}

export function BusinessStateSettingsView({
  notice,
  onReset,
  onRestore,
  onRetry,
  pending,
  state,
}: {
  notice: string | null;
  onReset(): void;
  onRestore(generation: BusinessStateGeneration): void;
  onRetry(): void;
  pending: boolean;
  state: ViewState;
}) {
  if (state.status !== "ready") {
    return (
      <section className="business-state-panel" aria-label="Business data recovery">
        <h2>Business Data Recovery</h2>
        {state.status === "loading" ? <p>Loading recovery points...</p> : null}
        {state.status === "denied" ? <p>This page is not available for your account.</p> : null}
        {state.status === "error" ? (
          <><p>Recovery points could not be loaded.</p><button onClick={onRetry} type="button">Try again</button></>
        ) : null}
      </section>
    );
  }
  const active = state.generations.find(({ id }) => id === state.activeGenerationId);
  const sealed = state.generations.filter(({ status }) => status === "sealed");
  return (
    <section className="business-state-panel" aria-labelledby="business-state-title">
      <header className="business-state-header">
        <div>
          <p>Recovery</p>
          <h2 id="business-state-title">Business Data</h2>
        </div>
        <button className="business-state-reset" disabled={pending} onClick={onReset} type="button">
          Start fresh
        </button>
      </header>
      {notice === null ? null : <div className="business-state-notice" role="status">{notice}</div>}
      {active === undefined ? (
        <p className="business-state-error">The active business-data generation is unavailable.</p>
      ) : (
        <div className="business-state-active">
          <span>Active generation</span>
          <strong>{active.code}</strong>
          <small>Started {formatTimestamp(active.createdAt)}</small>
        </div>
      )}
      <div className="business-state-list" aria-label="Recovery points">
        <h3>Recovery points</h3>
        {sealed.length === 0 ? (
          <p className="business-state-empty">No prior generations have been sealed.</p>
        ) : sealed.map((generation) => (
          <article className="business-state-row" key={generation.id}>
            <div>
              <strong>{generation.code}</strong>
              <span>{formatTimestamp(generation.sealedAt ?? generation.createdAt)}</span>
            </div>
            <GenerationCounts generation={generation} />
            <button disabled={pending} onClick={() => onRestore(generation)} type="button">Restore</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function GenerationCounts({ generation }: { generation: BusinessStateGeneration }) {
  const counts = generation.rowCounts;
  if (counts === null) return <span>Manifest unavailable</span>;
  return (
    <span>
      {counts.policies} policies · {counts.drafts} drafts · {counts.paySheets} pay sheets
    </span>
  );
}

export function BusinessStateDialog({
  dialog,
  error,
  onCancel,
  onChange,
  onSubmit,
  pending,
}: {
  dialog: TransitionDialog | null;
  error: string | null;
  onCancel(): void;
  onChange(dialog: TransitionDialog): void;
  onSubmit(): void;
  pending: boolean;
}) {
  if (dialog === null) return null;
  const expected = dialog.kind === "reset"
    ? BUSINESS_STATE_RESET_CONFIRMATION
    : `${BUSINESS_STATE_RESTORE_CONFIRMATION_PREFIX}${dialog.generation.code}`;
  const title = dialog.kind === "reset" ? "Start fresh" : `Restore ${dialog.generation.code}`;
  return (
    <div className="business-state-dialog-backdrop">
      <section aria-labelledby="business-state-dialog-title" aria-modal="true" className="business-state-dialog" role="dialog">
        <h2 id="business-state-dialog-title">{title}</h2>
        <p>
          {dialog.kind === "reset"
            ? "Current transactional records will move to a sealed recovery point. Accounts, staff, rates, offices, and vocabularies remain active."
            : "Restore is available only while the current generation has no work entered after its reset."}
        </p>
        {dialog.kind === "reset" ? (
          <label className="business-state-check">
            <input
              checked={dialog.clearKpiTargets}
              disabled={pending}
              onChange={(event) => onChange({ ...dialog, clearKpiTargets: event.currentTarget.checked })}
              type="checkbox"
            />
            Clear KPI targets in the new generation
          </label>
        ) : null}
        <label className="business-state-confirmation">
          <span>Type <strong>{expected}</strong> to confirm</span>
          <input
            autoComplete="off"
            autoFocus
            disabled={pending}
            onChange={(event) => onChange({ ...dialog, confirmation: event.currentTarget.value })}
            value={dialog.confirmation}
          />
        </label>
        {error === null ? null : <div className="business-state-error" role="alert">{error}</div>}
        <footer>
          <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
          <button className="is-danger" disabled={pending || dialog.confirmation !== expected} onClick={onSubmit} type="button">
            {pending ? "Working..." : title}
          </button>
        </footer>
      </section>
    </div>
  );
}

function transitionError(error: unknown): string {
  if (error instanceof BusinessStateApiError) {
    if (error.kind === "conflict") {
      return "This recovery action conflicts with current work. Start fresh first to preserve that work, then restore.";
    }
    if (error.kind === "denied") return "Your session cannot perform this action.";
    if (error.kind === "rejected") return "The typed confirmation was rejected.";
  }
  return "The recovery action could not be completed. No business state was changed.";
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
