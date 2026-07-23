import React, { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { resetAdminMfaRequestSchema } from "../../../shared/admin-account-security.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { MfaStepUpDescriptor } from "../../../shared/mfa-scaffold.js";
import type {
  SupportAccountSecurityItem,
  SupportMfaMethod,
} from "../../../shared/support-account-security.js";
import { useSensitiveSessionCleanup } from "../api/context.js";
import { createMfaApi } from "../auth/mfa-api.js";
import { MfaStepUpDialog } from "../auth/MfaStepUpDialog.js";
import type { SupportApi } from "./api.js";

export interface ResetDraft {
  item: SupportAccountSecurityItem;
  reason: string;
}

export function SupportMfaRecovery({
  api,
  user,
}: {
  api: SupportApi;
  user: CurrentUser;
}) {
  const mfaApi = useMemo(() => createMfaApi(), []);
  const [items, setItems] = useState<SupportAccountSecurityItem[] | null>(null);
  const [draft, setDraft] = useState<ResetDraft | null>(null);
  const [pending, setPending] = useState<ResetDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clear = useCallback(() => {
    setItems(null);
    setDraft(null);
    setPending(null);
    setError(null);
    setNotice(null);
  }, []);
  useSensitiveSessionCleanup(clear);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.listAccounts());
    } catch {
      setError("Account recovery status could not be loaded.");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const descriptor: MfaStepUpDescriptor | null = pending === null
    ? null
    : {
        action: "mfa_reset",
        mutation: { reason: pending.reason },
        targetUserId: pending.item.id,
      };

  return (
    <section className="support-section support-recovery" aria-labelledby="support-recovery-title">
      <header className="support-section-heading">
        <div>
          <p>Account recovery</p>
          <h2 id="support-recovery-title">Reset another user&apos;s MFA</h2>
        </div>
        <button onClick={() => void load()} type="button">Refresh</button>
      </header>
      <p className="support-section-copy">
        A reset removes the target&apos;s factors and recovery grants, ends their sessions, and requires enrollment again.
      </p>
      {notice === null ? null : <p className="support-notice" role="status">{notice}</p>}
      {error === null ? null : <p className="support-error" role="alert">{error}</p>}
      {items === null ? (
        <p>Loading account recovery status...</p>
      ) : items.length === 0 ? (
        <p>No other accounts are available for recovery.</p>
      ) : (
        <SupportMfaAccountList
          items={items}
          onReset={(item) => {
            setError(null);
            setNotice(null);
            setDraft({ item, reason: "" });
          }}
        />
      )}
      {draft === null ? null : (
        <SupportMfaResetDialog
          draft={draft}
          onCancel={() => setDraft(null)}
          onReason={(reason) => setDraft((current) => current === null ? null : { ...current, reason })}
          onSubmit={(next) => {
            setDraft(null);
            setPending(next);
          }}
        />
      )}
      {pending === null || descriptor === null ? null : (
        <MfaStepUpDialog
          api={mfaApi}
          descriptor={descriptor}
          methods={user.mfa?.methods ?? []}
          onAuthorized={async (token) => {
            setError(null);
            try {
              await api.resetMfa(pending.item.id, pending.reason, token);
              setNotice(`${pending.item.displayName} must enroll MFA again.`);
              setPending(null);
              await load();
            } catch (caught) {
              setError("The MFA reset could not be completed.");
              throw caught;
            }
          }}
          onCancel={() => setPending(null)}
          title="Authorize MFA reset"
        />
      )}
    </section>
  );
}

export function SupportMfaAccountList({
  items,
  onReset,
}: {
  items: readonly SupportAccountSecurityItem[];
  onReset(item: SupportAccountSecurityItem): void;
}) {
  return (
    <div className="support-account-list">
      {items.map((item) => (
        <article className="support-account-row" key={item.id}>
          <div className="support-account-identity">
            <strong>{item.displayName}</strong>
            <span>{item.email}</span>
            <small>Last login {formatTimestamp(item.lastLoginAt)}</small>
          </div>
          <div className="support-account-mfa">
            <span className={`status-badge${item.mfa.enrolled ? " is-active" : ""}`}>
              {item.mfa.enrolled
                ? "MFA on"
                : item.mfa.enrollmentRequired
                  ? "Enrollment required"
                  : "MFA off"}
            </span>
            {item.mfa.methods.length === 0 ? (
              <small>No active MFA methods</small>
            ) : (
              <ul className="support-factor-list">
                {item.mfa.methods.map((method) => (
                  <li key={`${method.methodType}:${method.label}:${method.createdAt}`}>
                    <strong>{method.label}</strong>
                    <span>{methodTypeLabel(method)}{method.isPrimary ? " / Primary" : ""}</span>
                    <small>Added {formatTimestamp(method.createdAt)} / Last used {formatTimestamp(method.lastUsedAt)}</small>
                  </li>
                ))}
              </ul>
            )}
            <small>{item.mfa.recoveryCodesRemaining} recovery codes remaining</small>
          </div>
          <button onClick={() => onReset(item)} type="button">Reset MFA</button>
        </article>
      ))}
    </div>
  );
}

export function SupportMfaResetDialog({
  draft,
  onCancel,
  onReason,
  onSubmit,
}: {
  draft: ResetDraft;
  onCancel(): void;
  onReason(reason: string): void;
  onSubmit(draft: ResetDraft): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = resetAdminMfaRequestSchema.safeParse({ reason: draft.reason });
    if (!parsed.success) {
      setError("Enter a short reason for this recovery action.");
      return;
    }
    onSubmit({ ...draft, reason: parsed.data.reason });
  };
  return (
    <div className="staff-dialog-backdrop" role="presentation">
      <section aria-labelledby="support-reset-title" aria-modal="true" className="staff-dialog" role="dialog">
        <header>
          <div>
            <p>Account recovery</p>
            <h2 id="support-reset-title">Reset {draft.item.displayName}&apos;s MFA</h2>
          </div>
          <button onClick={onCancel} type="button">Close</button>
        </header>
        <form onSubmit={submit}>
          <div className="support-reset-impact">
            <p>
              {draft.item.mfa.methods.length === 0
                ? "No active MFA methods are registered. Sessions and recovery grants will still be revoked."
                : `This reset will remove ${draft.item.mfa.methods.length} active ${draft.item.mfa.methods.length === 1 ? "method" : "methods"}:`}
            </p>
            {draft.item.mfa.methods.length === 0 ? null : (
              <ul>
                {draft.item.mfa.methods.map((method) => (
                  <li key={`${method.methodType}:${method.label}:${method.createdAt}`}>
                    {method.label} ({methodTypeLabel(method)}{method.isPrimary ? ", primary" : ""})
                  </li>
                ))}
              </ul>
            )}
            <p>{draft.item.mfa.recoveryCodesRemaining} recovery codes will be revoked.</p>
          </div>
          <label className="staff-field">
            <span>Reason</span>
            <textarea
              autoFocus
              maxLength={500}
              onChange={(event) => onReason(event.currentTarget.value)}
              required
              rows={4}
              value={draft.reason}
            />
          </label>
          {error === null ? null : <p className="staff-dialog-error" role="alert">{error}</p>}
          <footer>
            <button onClick={onCancel} type="button">Cancel</button>
            <button className="is-primary" type="submit">Continue</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function methodTypeLabel(method: Pick<SupportMfaMethod, "methodType">): string {
  return method.methodType === "webauthn" ? "Passkey" : "Authenticator app";
}

function formatTimestamp(value: string | null): string {
  if (value === null) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
