import { startAuthentication } from "@simplewebauthn/browser";
import React, { useCallback, useRef, useState, type FormEvent } from "react";
import {
  totpCodeSchema,
  type MfaMethodSummary,
  type MfaStepUpDescriptor,
} from "../../../shared/mfa-scaffold.js";
import { MfaApiError, type MfaApi } from "./mfa-api.js";
import { useModalFocusTrap } from "./dialog-focus.js";

export function MfaStepUpDialog({
  api,
  descriptor,
  methods,
  onAuthorized,
  onCancel,
  title = "Confirm this sensitive change",
}: {
  api: MfaApi;
  descriptor: MfaStepUpDescriptor;
  methods: readonly MfaMethodSummary[];
  onAuthorized(token: string): Promise<void>;
  onCancel(): void;
  title?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPasskey = methods.some((method) => method.methodType === "webauthn");
  const hasTotp = methods.some((method) => method.methodType === "totp");

  const closeOnEscape = useCallback(() => {
    if (!pending) onCancel();
  }, [onCancel, pending]);
  useModalFocusTrap(dialogRef, passwordRef, closeOnEscape);

  const authorize = async (action: () => Promise<string>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const token = await action();
      await onAuthorized(token);
      setCurrentPassword("");
      setCode("");
    } catch (caught) {
      setError(stepUpError(caught));
      setCode("");
    } finally {
      setPending(false);
    }
  };

  const submitTotp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!totpCodeSchema.safeParse(code).success || currentPassword.length === 0) {
      return;
    }
    void authorize(async () =>
      (await api.stepUpWithTotp(currentPassword, code, descriptor)).token,
    );
  };

  return (
    <div className="staff-dialog-backdrop mfa-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="mfa-step-up-title"
        aria-modal="true"
        className="staff-dialog mfa-step-up-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <p>Account security</p>
            <h2 id="mfa-step-up-title">{title}</h2>
          </div>
          <button disabled={pending} onClick={onCancel} type="button">Close</button>
        </header>
        <div className="mfa-step-up-content">
          <p>Enter your current password and verify with an enrolled MFA method. This approval can be used only for this exact change.</p>
          {methods.length === 0 ? (
            <p className="staff-dialog-error" role="alert">
              Enroll MFA in Settings before performing this action.
            </p>
          ) : null}
          {error === null ? null : <p className="staff-dialog-error" role="alert">{error}</p>}
          <label className="staff-field">
            <span>Current password</span>
            <input
              autoComplete="current-password"
              disabled={pending}
              maxLength={1_024}
              onChange={(event) => setCurrentPassword(event.currentTarget.value)}
              ref={passwordRef}
              required
              type="password"
              value={currentPassword}
            />
          </label>
          {hasPasskey ? (
            <button
              className="is-primary mfa-passkey-action"
              disabled={pending || currentPassword.length === 0}
              onClick={() => {
                void authorize(async () => {
                  const started = await api.startPasskeyStepUp(
                    currentPassword,
                    descriptor,
                  );
                  const credential = await startAuthentication({
                    optionsJSON: started.options,
                  });
                  return (
                    await api.finishPasskeyStepUp(
                      started.challengeId,
                      credential,
                      descriptor,
                    )
                  ).token;
                });
              }}
              type="button"
            >
              {pending ? "Verifying..." : "Verify with security key or passkey"}
            </button>
          ) : null}
          {hasTotp ? (
            <form className="mfa-step-up-totp" onSubmit={submitTotp}>
              <label className="staff-field">
                <span>Authenticator code</span>
                <input
                  autoComplete="one-time-code"
                  disabled={pending}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  required
                  value={code}
                />
              </label>
              <button
                className={hasPasskey ? undefined : "is-primary"}
                disabled={
                  pending ||
                  currentPassword.length === 0 ||
                  !totpCodeSchema.safeParse(code).success
                }
                type="submit"
              >
                {pending ? "Verifying..." : "Verify code"}
              </button>
            </form>
          ) : null}
        </div>
        <footer>
          <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
        </footer>
      </section>
    </div>
  );
}

function stepUpError(error: unknown): string {
  if (error instanceof MfaApiError && error.kind === "throttled") {
    return `Too many attempts. Try again in ${error.retryAfterSeconds ?? 60} seconds.`;
  }
  if (error instanceof MfaApiError && error.kind === "invalid_challenge") {
    return "The password or MFA verification was not accepted.";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Passkey verification was cancelled or timed out.";
  }
  return "This sensitive change could not be authorized. Try again.";
}
