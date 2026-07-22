import React, { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { resetAdminMfaRequestSchema } from "../../../shared/admin-account-security.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { MfaStepUpDescriptor } from "../../../shared/mfa-scaffold.js";
import type { SupportAccountSecurityItem } from "../../../shared/support-account-security.js";
import { useSensitiveSessionCleanup } from "../api/context.js";
import { createMfaApi } from "../auth/mfa-api.js";
import { MfaStepUpDialog } from "../auth/MfaStepUpDialog.js";
import type { SupportApi } from "./api.js";

interface ResetDraft {
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
        <div className="support-account-list">
          {items.map((item) => (
            <article className="support-account-row" key={item.id}>
              <div>
                <strong>{item.displayName}</strong>
                <span>{item.email}</span>
              </div>
              <span className={`status-badge${item.mfaEnrolled ? " is-active" : ""}`}>
                {item.mfaEnrolled
                  ? "MFA on"
                  : item.mfaEnrollmentRequired
                    ? "Enrollment required"
                    : "MFA off"}
              </span>
              <button
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setDraft({ item, reason: "" });
                }}
                type="button"
              >
                Reset MFA
              </button>
            </article>
          ))}
        </div>
      )}
      {draft === null ? null : (
        <ResetReasonDialog
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

function ResetReasonDialog({
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
