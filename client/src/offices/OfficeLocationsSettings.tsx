import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  AdminOfficeLocation,
  AdminOfficeManagementResponse,
} from "../../../shared/admin-office-locations.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import {
  AdminOfficeApiError,
  createAdminOfficeApi,
} from "./api.js";
import { BusinessStateSettings } from "../business-state/BusinessStateSettings.js";

type OfficeState =
  | { status: "denied" | "error" | "loading" }
  | ({ status: "ready" } & AdminOfficeManagementResponse);

type EditorDialog =
  | { kind: "create"; name: string }
  | { kind: "rename"; name: string; office: AdminOfficeLocation };

type ActiveDialog = {
  active: boolean;
  mode: AdminOfficeManagementResponse["mode"];
  office: AdminOfficeLocation;
};

export function OfficeLocationsSettings({
  embedded = false,
  user,
}: {
  embedded?: boolean;
  user: CurrentUser;
}) {
  const isAdmin = user.role === "admin" && user.capabilities.includes("admin");
  const isSupportEngineer = user.capabilities.includes("support_engineer");
  if (!isAdmin && !isSupportEngineer) {
    return <OfficeMessage kind="denied" />;
  }
  return (
    <OfficeLocationsController
      embedded={embedded}
      includeBusinessState={isAdmin}
    />
  );
}

function OfficeLocationsController({
  embedded,
  includeBusinessState,
}: {
  embedded: boolean;
  includeBusinessState: boolean;
}) {
  const client = useApiClient();
  const api = useMemo(() => createAdminOfficeApi(client), [client]);
  const [state, setState] = useState<OfficeState>({ status: "loading" });
  const [editor, setEditor] = useState<EditorDialog | null>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const clear = useCallback(() => {
    setState({ status: "loading" });
    setEditor(null);
    setActiveDialog(null);
    setError(null);
    setNotice(null);
    setPending(false);
  }, []);
  useSensitiveSessionCleanup(clear);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ ...(await api.list()), status: "ready" });
    } catch (caught) {
      setState({ status: officeFailureKind(caught) });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = useCallback(
    async (
      operation: () => Promise<AdminOfficeManagementResponse>,
      success: string,
    ) => {
      if (pending) return;
      setPending(true);
      setError(null);
      setNotice(null);
      try {
        const result = await operation();
        setState({ ...result, status: "ready" });
        setEditor(null);
        setActiveDialog(null);
        setNotice(success);
      } catch (caught) {
        setError(officeMutationMessage(caught));
      } finally {
        setPending(false);
      }
    },
    [pending],
  );

  return (
    <>
      <OfficeLocationsView
        embedded={embedded}
        notice={notice}
        onActive={(office, active, mode) => {
          setError(null);
          setActiveDialog({ active, mode, office });
        }}
        onAdd={() => {
          setError(null);
          setEditor({ kind: "create", name: "" });
        }}
        onRename={(office) => {
          setError(null);
          setEditor({ kind: "rename", name: office.name, office });
        }}
        onRetry={() => void load()}
        pending={pending}
        state={state}
      />
      {includeBusinessState ? <BusinessStateSettings /> : null}
      <OfficeEditorDialog
        dialog={editor}
        error={error}
        onCancel={() => {
          if (!pending) {
            setEditor(null);
            setError(null);
          }
        }}
        onChange={(name) => setEditor((current) => current === null ? null : { ...current, name })}
        onSubmit={(dialog) => {
          const success = dialog.kind === "create"
            ? "Office location added."
            : "Office location renamed.";
          void runMutation(
            () => dialog.kind === "create"
              ? api.create(dialog.name)
              : api.rename(dialog.office.id, dialog.name),
            success,
          );
        }}
        pending={pending}
      />
      <OfficeActiveDialog
        dialog={activeDialog}
        error={error}
        onCancel={() => {
          if (!pending) {
            setActiveDialog(null);
            setError(null);
          }
        }}
        onConfirm={(dialog) => {
          void runMutation(
            () => api.setActive(dialog.office.id, dialog.active),
            dialog.active ? "Office location reactivated." : "Office location deactivated.",
          );
        }}
        pending={pending}
      />
    </>
  );
}

export function OfficeLocationsView({
  embedded = false,
  notice,
  onActive,
  onAdd,
  onRename,
  onRetry,
  pending,
  state,
}: {
  embedded?: boolean;
  notice: string | null;
  onActive(
    office: AdminOfficeLocation,
    active: boolean,
    mode: AdminOfficeManagementResponse["mode"],
  ): void;
  onAdd(): void;
  onRename(office: AdminOfficeLocation): void;
  onRetry(): void;
  pending: boolean;
  state: OfficeState;
}) {
  if (state.status !== "ready") {
    return <OfficeMessage kind={state.status} onRetry={onRetry} />;
  }
  const active = state.items.filter((item) => item.isActive);
  const inactive = state.items.filter((item) => !item.isActive);
  const titleId = embedded ? "support-office-title" : "office-page-title";
  const Title = embedded ? "h2" : "h1";
  return (
    <section className={`office-page${embedded ? " is-embedded" : ""}`} aria-labelledby={titleId}>
      <header className="office-page-header">
        <div>
          <p>{embedded ? "Support operations" : "Settings"}</p>
          <Title id={titleId}>Office Locations</Title>
        </div>
        <button className="office-primary-action" disabled={pending} onClick={onAdd} type="button">
          Add location
        </button>
      </header>

      <OfficeModeSummary mode={state.mode} />
      {notice === null ? null : <div className="office-notice" role="status">{notice}</div>}

      <OfficeGroup
        items={active}
        mode={state.mode}
        onActive={onActive}
        onRename={onRename}
        pending={pending}
        title="Active locations"
      />
      <OfficeGroup
        items={inactive}
        mode={state.mode}
        onActive={onActive}
        onRename={onRename}
        pending={pending}
        title="Inactive locations"
      />
    </section>
  );
}

function OfficeModeSummary({ mode }: { mode: AdminOfficeManagementResponse["mode"] }) {
  const copy = mode.kind === "unconfigured"
    ? "Turn-ins are blocked until an office is active."
    : mode.kind === "single"
      ? "The active office is selected automatically and the picker stays hidden."
      : "The first active office is selected by default, and staff can choose another.";
  return (
    <section className={`office-mode is-${mode.kind}`} aria-label="Turn-in office behavior">
      <div>
        <span>Active offices</span>
        <strong>{mode.activeCount}</strong>
      </div>
      <p><strong>{modeLabel(mode.kind)}</strong> {copy}</p>
    </section>
  );
}

function OfficeGroup({
  items,
  mode,
  onActive,
  onRename,
  pending,
  title,
}: {
  items: readonly AdminOfficeLocation[];
  mode: AdminOfficeManagementResponse["mode"];
  onActive: Parameters<typeof OfficeLocationsView>[0]["onActive"];
  onRename: Parameters<typeof OfficeLocationsView>[0]["onRename"];
  pending: boolean;
  title: string;
}) {
  return (
    <section className="office-group" aria-labelledby={`office-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <header>
        <h2 id={`office-${title.toLowerCase().replace(/\s+/g, "-")}`}>{title}</h2>
        <span>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="office-empty">No {title.toLowerCase()}.</p>
      ) : (
        <div className="office-list">
          {items.map((office) => (
            <article className={`office-row${office.isActive ? "" : " is-inactive"}`} key={office.id}>
              <div>
                <h3>{office.name}</h3>
                <p>{office.isActive ? "Available on new turn-ins" : "Retained for historical records"}</p>
              </div>
              <span className={`office-status ${office.isActive ? "is-active" : "is-inactive"}`}>
                {office.isActive ? "Active" : "Inactive"}
              </span>
              <div className="office-row-actions">
                <button disabled={pending} onClick={() => onRename(office)} type="button">Rename</button>
                <button
                  disabled={pending}
                  onClick={() => onActive(office, !office.isActive, mode)}
                  type="button"
                >
                  {office.isActive ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function OfficeEditorDialog({
  dialog,
  error,
  onCancel,
  onChange,
  onSubmit,
  pending,
}: {
  dialog: EditorDialog | null;
  error: string | null;
  onCancel(): void;
  onChange(name: string): void;
  onSubmit(dialog: EditorDialog): void;
  pending: boolean;
}) {
  if (dialog === null) return null;
  const creating = dialog.kind === "create";
  return (
    <div className="office-dialog-backdrop">
      <section aria-labelledby="office-editor-title" aria-modal="true" className="office-dialog" role="dialog">
        <header>
          <p>Office settings</p>
          <h2 id="office-editor-title">{creating ? "Add office location" : "Rename office location"}</h2>
        </header>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            onSubmit(dialog);
          }}
        >
          <label className="office-field" htmlFor="office-name">
            <span>Location name</span>
            <input
              autoFocus
              disabled={pending}
              id="office-name"
              maxLength={200}
              onChange={(event) => onChange(event.currentTarget.value)}
              required
              value={dialog.name}
            />
          </label>
          {error === null ? null : <div className="office-dialog-error" role="alert">{error}</div>}
          <footer>
            <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
            <button className="is-primary" disabled={pending || dialog.name.trim() === ""} type="submit">
              {pending ? "Saving..." : creating ? "Add location" : "Save name"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function OfficeActiveDialog({
  dialog,
  error,
  onCancel,
  onConfirm,
  pending,
}: {
  dialog: ActiveDialog | null;
  error: string | null;
  onCancel(): void;
  onConfirm(dialog: ActiveDialog): void;
  pending: boolean;
}) {
  if (dialog === null) return null;
  const blocksTurnIns = !dialog.active && dialog.mode.kind === "single";
  return (
    <div className="office-dialog-backdrop">
      <section aria-labelledby="office-active-title" aria-modal="true" className="office-dialog is-confirmation" role="dialog">
        <header>
          <p>Confirm status change</p>
          <h2 id="office-active-title">{dialog.active ? "Reactivate" : "Deactivate"} {dialog.office.name}?</h2>
        </header>
        <p className="office-dialog-copy">
          {dialog.active
            ? "This location will become available on new turn-ins."
            : "Historical references remain intact. The location will no longer appear on new turn-ins."}
        </p>
        {blocksTurnIns ? (
          <p className="office-dialog-warning">
            This is the only active office. Deactivating it will block all turn-in saves and submissions.
          </p>
        ) : null}
        {error === null ? null : <div className="office-dialog-error" role="alert">{error}</div>}
        <footer>
          <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
          <button className={dialog.active ? "is-primary" : "is-danger"} disabled={pending} onClick={() => onConfirm(dialog)} type="button">
            {pending ? "Saving..." : dialog.active ? "Reactivate" : "Deactivate"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function OfficeMessage({ kind, onRetry }: { kind: "denied" | "error" | "loading"; onRetry?(): void }) {
  if (kind === "loading") {
    return <section className="office-message"><h1>Loading office locations</h1></section>;
  }
  if (kind === "denied") {
    return <section className="office-message"><h1>Office settings unavailable</h1><p>This workspace requires office-management access.</p></section>;
  }
  return <section className="office-message"><h1>Office locations unavailable</h1><p>The current configuration could not be loaded.</p><button onClick={onRetry} type="button">Try again</button></section>;
}

function modeLabel(kind: AdminOfficeManagementResponse["mode"]["kind"]): string {
  if (kind === "unconfigured") return "Setup required.";
  if (kind === "single") return "Automatic selection.";
  return "Required picker.";
}

function officeFailureKind(error: unknown): "denied" | "error" {
  return error instanceof AdminOfficeApiError && error.kind === "denied" ? "denied" : "error";
}

function officeMutationMessage(error: unknown): string {
  if (error instanceof AdminOfficeApiError) {
    if (error.kind === "conflict") return "That office name is already in use or the location changed. Your entry was kept.";
    if (error.kind === "rejected") return "Enter a valid office name and try again.";
    if (error.kind === "denied") return "Your admin session no longer permits this change.";
  }
  return "The office location could not be saved. Try again.";
}
