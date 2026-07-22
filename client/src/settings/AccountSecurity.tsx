import React, { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  resetAdminMfaRequestSchema,
  updateAdminAccountEmailRequestSchema,
  type AdminAccountSecurityItem,
} from "../../../shared/admin-account-security.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { MfaStepUpDescriptor } from "../../../shared/mfa-scaffold.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { createMfaApi } from "../auth/mfa-api.js";
import { MfaStepUpDialog } from "../auth/MfaStepUpDialog.js";
import {
  AccountSecurityApiError,
  createAccountSecurityApi,
} from "./account-security-api.js";

type SensitiveMutation =
  | { enabled: boolean; item: AdminAccountSecurityItem; kind: "capability" }
  | { email: string; item: AdminAccountSecurityItem; kind: "email" }
  | { item: AdminAccountSecurityItem; kind: "reset"; reason: string };

type DraftDialog =
  | { item: AdminAccountSecurityItem; kind: "email" }
  | { item: AdminAccountSecurityItem; kind: "reset" };

export function AccountSecurityPanel({ user }: { user: CurrentUser }) {
  const client = useApiClient();
  const api = useMemo(() => createAccountSecurityApi(client), [client]);
  const mfaApi = useMemo(() => createMfaApi(), []);
  const [items, setItems] = useState<AdminAccountSecurityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftDialog | null>(null);
  const [mutation, setMutation] = useState<SensitiveMutation | null>(null);

  const clear = useCallback(() => {
    setItems(null);
    setDraft(null);
    setMutation(null);
    setError(null);
  }, []);
  useSensitiveSessionCleanup(clear);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.list());
    } catch {
      setError("Account security could not be loaded.");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (items === null) {
    return (
      <section className="settings-panel account-security-panel" aria-busy={error === null}>
        <header><h2>Account security</h2><p>Administrator recovery and access controls.</p></header>
        {error === null ? <p>Loading account security...</p> : <p className="settings-error" role="alert">{error}</p>}
        {error === null ? null : <button onClick={() => void load()} type="button">Try again</button>}
      </section>
    );
  }

  const descriptor = mutation === null ? null : mutationDescriptor(mutation);
  return (
    <section className="settings-panel account-security-panel" aria-labelledby="account-security-title" role="tabpanel">
      <header>
        <h2 id="account-security-title">Account security</h2>
        <p>Manage administrator recovery, sign-in email, and the separate administrator capability.</p>
      </header>
      {user.mfa?.enrolled !== true ? (
        <p className="mfa-recommendation" role="status">
          Enroll MFA before using these sensitive controls. Recovery codes cannot approve a step-up action.
        </p>
      ) : null}
      {error === null ? null : <p className="settings-error" role="alert">{error}</p>}
      <div className="account-security-list">
        {items.map((item) => (
          <article className="account-security-row" key={item.id}>
            <div className="account-security-identity">
              <strong>{item.displayName}</strong>
              <span>{item.email}</span>
              <small>{accountRole(item)}</small>
            </div>
            <div className="account-security-mfa">
              <span className={item.mfa.enrolled ? "status-badge is-active" : "status-badge"}>
                {item.mfa.enrolled ? "MFA on" : "MFA off"}
              </span>
              <span>{item.mfa.methods.length === 0 ? "No methods" : item.mfa.methods.map(methodLabel).join(" + ")}</span>
              {item.mfa.enrolled ? <small>{item.mfa.recoveryCodesRemaining} recovery codes</small> : null}
              {item.mfa.enrollmentRequired ? <small className="account-security-required">Enrollment required</small> : null}
            </div>
            <div className="account-security-actions">
              <button onClick={() => setDraft({ item, kind: "email" })} type="button">Change email</button>
              <button
                disabled={item.id === user.id && item.adminCapability}
                onClick={() => setMutation({ enabled: !item.adminCapability, item, kind: "capability" })}
                title={item.id === user.id && item.adminCapability ? "Another administrator must retain recovery access" : undefined}
                type="button"
              >
                {item.adminCapability ? "Remove admin" : "Make admin"}
              </button>
              <button
                disabled={!item.mfa.enrolled || item.id === user.id}
                onClick={() => setDraft({ item, kind: "reset" })}
                title={item.id === user.id ? "Another administrator must reset your MFA" : undefined}
                type="button"
              >
                Reset MFA
              </button>
            </div>
          </article>
        ))}
      </div>
      {draft === null ? null : (
        <AccountSecurityInputDialog
          draft={draft}
          onCancel={() => setDraft(null)}
          onContinue={(next) => {
            setDraft(null);
            setMutation(next);
          }}
        />
      )}
      {mutation !== null && descriptor !== null ? (
        <MfaStepUpDialog
          api={mfaApi}
          descriptor={descriptor}
          methods={user.mfa?.methods ?? []}
          onAuthorized={async (token) => {
            setError(null);
            try {
              if (mutation.kind === "capability") {
                await api.setAdminCapability(mutation.item.id, mutation.enabled, token);
              } else if (mutation.kind === "email") {
                await api.updateEmail(mutation.item.id, mutation.email, token);
              } else {
                await api.resetMfa(mutation.item.id, mutation.reason, token);
              }
              setMutation(null);
              await load();
            } catch (caught) {
              if (caught instanceof AccountSecurityApiError && caught.kind === "conflict") {
                setError("That change conflicts with the current account state.");
              } else {
                setError("The account security change could not be completed.");
              }
              throw caught;
            }
          }}
          onCancel={() => setMutation(null)}
          title={stepUpTitle(mutation)}
        />
      ) : null}
    </section>
  );
}

function AccountSecurityInputDialog({
  draft,
  onCancel,
  onContinue,
}: {
  draft: DraftDialog;
  onCancel(): void;
  onContinue(mutation: SensitiveMutation): void;
}) {
  const [value, setValue] = useState(draft.kind === "email" ? draft.item.email : "");
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.kind === "email") {
      const parsed = updateAdminAccountEmailRequestSchema.safeParse({ email: value });
      if (!parsed.success) {
        setError("Enter a valid sign-in email.");
        return;
      }
      onContinue({ email: parsed.data.email, item: draft.item, kind: "email" });
      return;
    }
    const parsed = resetAdminMfaRequestSchema.safeParse({ reason: value });
    if (!parsed.success) {
      setError("Enter a short reason for the MFA reset.");
      return;
    }
    onContinue({ item: draft.item, kind: "reset", reason: parsed.data.reason });
  };
  return (
    <div className="staff-dialog-backdrop" role="presentation">
      <section aria-labelledby="account-security-dialog-title" aria-modal="true" className="staff-dialog" role="dialog">
        <header>
          <div><p>Account security</p><h2 id="account-security-dialog-title">{draft.kind === "email" ? "Change sign-in email" : "Reset MFA"}</h2></div>
          <button onClick={onCancel} type="button">Close</button>
        </header>
        <form onSubmit={submit}>
          <p>{draft.item.displayName}</p>
          <label className="staff-field">
            <span>{draft.kind === "email" ? "New email" : "Reason"}</span>
            {draft.kind === "email" ? (
              <input autoComplete="off" onChange={(event) => setValue(event.currentTarget.value)} required type="email" value={value} />
            ) : (
              <textarea maxLength={500} onChange={(event) => setValue(event.currentTarget.value)} required rows={4} value={value} />
            )}
          </label>
          {error === null ? null : <p className="staff-dialog-error" role="alert">{error}</p>}
          <footer><button onClick={onCancel} type="button">Cancel</button><button className="is-primary" type="submit">Continue</button></footer>
        </form>
      </section>
    </div>
  );
}

function mutationDescriptor(mutation: SensitiveMutation): MfaStepUpDescriptor {
  if (mutation.kind === "capability") {
    return { action: "admin_capability_change", mutation: { enabled: mutation.enabled }, targetUserId: mutation.item.id };
  }
  if (mutation.kind === "email") {
    return { action: "admin_staff_update", mutation: { email: mutation.email }, targetUserId: mutation.item.id };
  }
  return { action: "mfa_reset", mutation: { reason: mutation.reason }, targetUserId: mutation.item.id };
}

function stepUpTitle(mutation: SensitiveMutation): string {
  if (mutation.kind === "capability") return mutation.enabled ? "Grant administrator access" : "Remove administrator access";
  if (mutation.kind === "email") return "Change sign-in email";
  return "Reset this account's MFA";
}

function methodLabel(method: "totp" | "webauthn"): string {
  return method === "webauthn" ? "Security key / passkey" : "Authenticator";
}

function accountRole(item: AdminAccountSecurityItem): string {
  if (item.adminCapability) return "Administrator";
  if (item.staffRole === "producer") return "Producer";
  if (item.staffRole === "employee") return "Employee";
  return "Capability-only account";
}
