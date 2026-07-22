import { startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { QRCodeSVG } from "qrcode.react";
import React, {
  useCallback,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  MFA_RECOVERY_CODE_WARNING_COUNTS,
  mfaMethodLabelSchema,
  totpCodeSchema,
  type MfaMethodSummary,
  type MfaState,
} from "../../../shared/mfa-scaffold.js";
import { useModalFocusTrap } from "./dialog-focus.js";
import { MfaApiError, type MfaApi } from "./mfa-api.js";
import { MfaStepUpDialog } from "./MfaStepUpDialog.js";

interface TotpSetup {
  methodId: string;
  otpauthUrl: string;
  secret: string;
}

type MfaSettingsStepUp =
  | { kind: "disable" }
  | { kind: "remove"; method: MfaMethodSummary };

type EnrollmentMethodType = "totp" | "webauthn";

export function RequiredMfaEnrollment({
  api,
  onComplete,
  onLogout,
  user,
}: {
  api: MfaApi;
  onComplete(mfa: MfaState): Promise<void>;
  onLogout(): void;
  user: CurrentUser;
}) {
  const initial = user.mfa;
  if (initial === undefined) {
    return (
      <main className="auth-status-page">
        <section className="auth-status" role="alert">
          <h1>Account protection unavailable</h1>
          <p>Your security status could not be loaded.</p>
          <button onClick={onLogout} type="button">Sign out</button>
        </section>
      </main>
    );
  }
  return (
    <main className="mfa-enrollment-page">
      <MfaEnrollmentCard
        api={api}
        initialMfa={initial}
        onComplete={onComplete}
        onLogout={onLogout}
        recovery={user.authenticationState === "mfa_recovery"}
        required
      />
    </main>
  );
}

export function RecommendedMfaEnrollment({
  api,
  onComplete,
  onDismiss,
  user,
}: {
  api: MfaApi;
  onComplete(mfa: MfaState): Promise<void>;
  onDismiss(): void;
  user: CurrentUser;
}) {
  const initial = user.mfa;
  if (initial === undefined) return null;
  return (
    <main className="mfa-enrollment-page">
      <MfaEnrollmentCard
        api={api}
        initialMfa={initial}
        onCancel={onDismiss}
        onComplete={onComplete}
      />
    </main>
  );
}

export function MfaSettingsPanel({
  api,
  initialMfa,
  onMfaChange,
  userId,
}: {
  api: MfaApi;
  initialMfa: MfaState;
  onMfaChange(mfa: MfaState): void;
  userId: string;
}) {
  const [mfa, setMfa] = useState(initialMfa);
  const [enrolling, setEnrolling] = useState(false);
  const [editingMethod, setEditingMethod] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [stepUp, setStepUp] = useState<MfaSettingsStepUp | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const updateState = (next: MfaState) => {
    setMfa(next);
    onMfaChange(next);
  };
  const disableBlocked = mfa.policyRequired;

  const renameMethod = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingMethod === null || pending) return;
    const parsed = mfaMethodLabelSchema.safeParse(editingMethod.label);
    if (!parsed.success) {
      setError("Enter a nickname for this security method.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      updateState(
        await api.renameMethod(editingMethod.id, parsed.data),
      );
      setEditingMethod(null);
    } catch {
      setError("The security method could not be renamed.");
    } finally {
      setPending(false);
    }
  };

  if (enrolling || codes !== null) {
    return (
      <MfaEnrollmentCard
        api={api}
        initialCodes={codes}
        initialMfa={mfa}
        onCancel={() => {
          setCodes(null);
          setEnrolling(false);
        }}
        onComplete={async (next) => {
          updateState(next);
          setCodes(null);
          setEnrolling(false);
        }}
      />
    );
  }

  return (
    <section className="settings-panel mfa-settings-panel" aria-labelledby="mfa-settings-title">
      <header>
        <h2 id="mfa-settings-title">Multi-factor authentication</h2>
        <p>Security keys and device passkeys provide phishing-resistant protection. Authenticator apps are available as a fallback.</p>
      </header>
      {mfa.adminRecommended && !mfa.enrolled ? (
        <p className="mfa-recommendation" role="status">
          Protect this administrator account before using sensitive account controls.
        </p>
      ) : null}
      <div className="mfa-status-row">
        <div>
          <strong>{mfa.enrolled ? "MFA is on" : "MFA is off"}</strong>
          <span>
            {mfa.enrolled
              ? `${mfa.methods.length} enrolled ${mfa.methods.length === 1 ? "method" : "methods"}`
              : "Password-only sign-in"}
          </span>
        </div>
        <span className={mfa.enrolled ? "status-badge is-active" : "status-badge"}>
          {mfa.enrolled ? "Protected" : "Not enrolled"}
        </span>
      </div>
      {mfa.methods.length > 0 ? (
        <ul className="mfa-method-list">
          {mfa.methods.map((method) => {
            const editing = editingMethod?.id === method.id;
            return (
              <li key={method.id}>
                {editing && editingMethod !== null ? (
                  <form className="mfa-method-rename" onSubmit={renameMethod}>
                    <label htmlFor={`mfa-method-label-${method.id}`}>Nickname</label>
                    <input
                      autoComplete="off"
                      disabled={pending}
                      id={`mfa-method-label-${method.id}`}
                      maxLength={100}
                      onChange={(event) => setEditingMethod({
                        id: method.id,
                        label: event.currentTarget.value,
                      })}
                      required
                      value={editingMethod.label}
                    />
                    <div className="mfa-method-row-actions">
                      <button
                        disabled={pending}
                        onClick={() => {
                          setEditingMethod(null);
                          setError(null);
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="is-primary"
                        disabled={
                          pending ||
                          !mfaMethodLabelSchema.safeParse(editingMethod.label).success
                        }
                        type="submit"
                      >
                        {pending ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="mfa-method-identity">
                      <strong>{method.label}</strong>
                      <span>
                        {method.methodType === "webauthn"
                          ? "Passkey or security key"
                          : "Authenticator app"}
                      </span>
                    </div>
                    <div className="mfa-method-row-actions">
                      {method.isPrimary ? (
                        <span className="status-badge">Preferred</span>
                      ) : null}
                      <button
                        aria-label={`Rename ${method.label}`}
                        disabled={pending}
                        onClick={() => {
                          setEditingMethod({ id: method.id, label: method.label });
                          setError(null);
                        }}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        aria-label={`Remove ${method.label}`}
                        className="mfa-danger-action"
                        disabled={pending || mfa.methods.length === 1}
                        onClick={() => setStepUp({ kind: "remove", method })}
                        title={
                          mfa.methods.length === 1
                            ? "Use Turn off MFA to remove your final method"
                            : undefined
                        }
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {mfa.enrolled ? (
        <RecoveryCodeStatus remaining={mfa.recoveryCodesRemaining} />
      ) : null}
      {error === null ? null : <p className="settings-error" role="alert">{error}</p>}
      <div className="mfa-settings-actions">
        <button className="settings-primary-action" onClick={() => setEnrolling(true)} type="button">
          {mfa.enrolled ? "Add another method" : "Set up MFA"}
        </button>
        {mfa.enrolled ? (
          <button
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              void api.regenerateRecoveryCodes()
                .then((result) => {
                  updateState(result.mfa);
                  setCodes(result.recoveryCodes);
                })
                .catch(() => setError("Recovery codes could not be regenerated."))
                .finally(() => setPending(false));
            }}
            type="button"
          >
            {pending ? "Generating..." : "Regenerate recovery codes"}
          </button>
        ) : null}
        {mfa.enrolled ? (
          <button
            className="mfa-danger-action"
            disabled={disableBlocked}
            onClick={() => setStepUp({ kind: "disable" })}
            title={disableBlocked ? "MFA is required by administrator policy" : undefined}
            type="button"
          >
            Turn off MFA
          </button>
        ) : null}
      </div>
      {stepUp !== null ? (
        <MfaStepUpDialog
          api={api}
          descriptor={{
            action: "mfa_disable",
            mutation:
              stepUp.kind === "disable"
                ? { enabled: false }
                : { methodId: stepUp.method.id },
            targetUserId: userId,
          }}
          methods={mfa.methods}
          onAuthorized={async (token) => {
            if (stepUp.kind === "disable") {
              await api.disable(token);
              updateState(await api.loadSettings());
            } else {
              updateState(await api.removeMethod(stepUp.method.id, token));
            }
            setStepUp(null);
          }}
          onCancel={() => setStepUp(null)}
          title={
            stepUp.kind === "disable"
              ? "Turn off multi-factor authentication"
              : `Remove ${stepUp.method.label}`
          }
        />
      ) : null}
    </section>
  );
}

function MfaEnrollmentCard({
  api,
  initialCodes = null,
  initialMfa,
  onCancel,
  onComplete,
  onLogout,
  recovery = false,
  required = false,
}: {
  api: MfaApi;
  initialCodes?: string[] | null;
  initialMfa: MfaState;
  onCancel?(): void;
  onComplete(mfa: MfaState): Promise<void>;
  onLogout?(): void;
  recovery?: boolean;
  required?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [mfa, setMfa] = useState(initialMfa);
  const [selectedMethod, setSelectedMethod] = useState<EnrollmentMethodType | null>(null);
  const [methodDraft, setMethodDraft] = useState<EnrollmentMethodType | null>(null);
  const [methodLabel, setMethodLabel] = useState("");
  const [totp, setTotp] = useState<TotpSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(initialCodes);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useModalFocusTrap(panelRef, headingRef);
  const needsReplacementCodes =
    recoveryCodes === null &&
    mfa.methods.length > 0 &&
    !mfa.recoveryCodesAcknowledged;
  const choosingMethod =
    recoveryCodes === null &&
    !needsReplacementCodes &&
    methodDraft === null &&
    totp === null;

  const completeEnrollment = async (next: MfaState) => {
    setMfa(next);
    await onComplete(next);
  };

  const enrollPasskey = async (label: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const started = await api.startPasskeyEnrollment();
      const credential = await startRegistration({ optionsJSON: started.options });
      const result = await api.confirmPasskeyEnrollment(
        started.challengeId,
        credential,
        label,
      );
      setSelectedMethod(null);
      setMethodDraft(null);
      setMethodLabel("");
      setMfa(result.mfa);
      if (result.recoveryCodes !== null) setRecoveryCodes(result.recoveryCodes);
      else await completeEnrollment(result.mfa);
    } catch (caught) {
      setError(enrollmentError(caught));
    } finally {
      setPending(false);
    }
  };

  const startTotp = async (label: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const started = await api.startTotpEnrollment(label);
      setTotp(started);
      setSelectedMethod(null);
      setMethodDraft(null);
      setMethodLabel("");
    } catch (caught) {
      setError(enrollmentError(caught));
    } finally {
      setPending(false);
    }
  };

  const continueMethodEnrollment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (methodDraft === null || pending) return;
    const parsed = mfaMethodLabelSchema.safeParse(methodLabel);
    if (!parsed.success) {
      setError("Enter a nickname for this security method.");
      return;
    }
    if (methodDraft === "webauthn") {
      void enrollPasskey(parsed.data);
    } else {
      void startTotp(parsed.data);
    }
  };

  const confirmTotp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (totp === null || !totpCodeSchema.safeParse(totpCode).success || pending) return;
    setPending(true);
    setError(null);
    void api.confirmTotpEnrollment(totp.methodId, totpCode)
      .then(async (result) => {
        setMfa(result.mfa);
        setTotp(null);
        setTotpCode("");
        if (result.recoveryCodes !== null) setRecoveryCodes(result.recoveryCodes);
        else await completeEnrollment(result.mfa);
      })
      .catch((caught) => setError(enrollmentError(caught)))
      .finally(() => setPending(false));
  };

  const acknowledge = async () => {
    if (!saved || pending) return;
    setPending(true);
    setError(null);
    try {
      await api.acknowledgeRecoveryCodes();
      const next = await api.loadSettings();
      await completeEnrollment(next);
    } catch (caught) {
      setError(enrollmentError(caught));
    } finally {
      setPending(false);
    }
  };

  const replaceUnseenRecoveryCodes = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.regenerateRecoveryCodes();
      if (result.recoveryCodes === null) {
        throw new MfaApiError("invalid_response");
      }
      setMfa(result.mfa);
      setRecoveryCodes(result.recoveryCodes);
    } catch (caught) {
      setError(enrollmentError(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="mfa-enrollment-title"
      aria-modal={required ? "true" : undefined}
      className={`mfa-enrollment-panel${required ? " is-required" : ""}`}
      ref={panelRef}
      role={required ? "dialog" : undefined}
    >
      <header>
        <p>Account security</p>
        <h1 id="mfa-enrollment-title" ref={headingRef} tabIndex={-1}>
          {recovery
            ? "Restore account protection"
            : recoveryCodes !== null
              ? "Save your recovery codes"
              : needsReplacementCodes
                ? "Replace your recovery codes"
                : methodDraft !== null
                  ? methodDraft === "webauthn"
                    ? "Name your security key or passkey"
                    : "Name your authenticator"
                : totp !== null
                  ? "Connect your authenticator app"
                  : mfa.enrolled
                    ? "Add a security method"
                    : "Protect your account"}
        </h1>
        <p>
          {recoveryCodes !== null
            ? "Each code works once if your normal MFA method is unavailable."
            : needsReplacementCodes
              ? "Your earlier codes cannot be displayed again. Generate a replacement set to finish protecting this account."
              : methodDraft !== null
                ? "Choose a nickname that identifies this device or app in your security settings."
              : recovery
                ? "Your recovery code opened only this setup flow. Enroll a new method to regain account access."
                : "Use a security key or device passkey when possible. You can use an authenticator app instead."}
        </p>
      </header>
      {error === null ? null : <div className="form-alert" role="alert">{error}</div>}

      {recoveryCodes !== null ? (
        <RecoveryCodesStep
          codes={recoveryCodes}
          onSavedChange={setSaved}
          saved={saved}
        />
      ) : needsReplacementCodes ? (
        <div className="mfa-recovery-replacement">
          <p>The prior recovery codes are revoked when the replacement set is generated.</p>
          <button
            className="is-primary"
            disabled={pending}
            onClick={() => void replaceUnseenRecoveryCodes()}
            type="button"
          >
            {pending ? "Generating..." : "Generate replacement codes"}
          </button>
        </div>
      ) : methodDraft !== null ? (
        <form className="mfa-method-name-form" onSubmit={continueMethodEnrollment}>
          <label htmlFor="mfa-new-method-label">Nickname</label>
          <input
            autoComplete="off"
            autoFocus
            disabled={pending}
            id="mfa-new-method-label"
            maxLength={100}
            onChange={(event) => setMethodLabel(event.currentTarget.value)}
            placeholder={
              methodDraft === "webauthn"
                ? "Personal YubiKey"
                : "Yubico Authenticator"
            }
            required
            value={methodLabel}
          />
          <div className="mfa-enrollment-actions">
            <button
              disabled={pending}
              onClick={() => {
                setMethodDraft(null);
                setMethodLabel("");
                setError(null);
              }}
              type="button"
            >
              Back
            </button>
            <button
              className="is-primary"
              disabled={
                pending || !mfaMethodLabelSchema.safeParse(methodLabel).success
              }
              type="submit"
            >
              {pending ? "Starting..." : "Continue"}
            </button>
          </div>
        </form>
      ) : totp !== null ? (
        <form className="mfa-totp-setup" onSubmit={confirmTotp}>
          <div className="mfa-qr-code" aria-label="Authenticator setup QR code">
            <QRCodeSVG level="M" size={184} value={totp.otpauthUrl} />
          </div>
          <p>Scan this code with your authenticator app, or enter this setup key:</p>
          <code className="mfa-secret">{totp.secret}</code>
          <label htmlFor="mfa-enrollment-code">6-digit code</label>
          <input
            autoComplete="one-time-code"
            disabled={pending}
            id="mfa-enrollment-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setTotpCode(event.currentTarget.value)}
            required
            value={totpCode}
          />
          <div className="mfa-enrollment-actions">
            <button
              disabled={pending}
              onClick={() => {
                setTotp(null);
                setTotpCode("");
                setError(null);
              }}
              type="button"
            >
              Back
            </button>
            <button
              className="is-primary"
              disabled={pending || !totpCodeSchema.safeParse(totpCode).success}
              type="submit"
            >
              {pending ? "Checking..." : "Verify and continue"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mfa-method-choices">
          <button
            aria-pressed={selectedMethod === "webauthn"}
            className={`mfa-method-choice${selectedMethod === "webauthn" ? " is-selected" : ""}`}
            disabled={pending}
            onClick={() => {
              setSelectedMethod("webauthn");
              setError(null);
            }}
            type="button"
          >
            <strong>Set up a security key or passkey</strong>
            <span>Tap a YubiKey without a WCIB-required key PIN, or use Face ID, Touch ID, or Windows Hello.</span>
          </button>
          <button
            aria-pressed={selectedMethod === "totp"}
            className={`mfa-method-choice${selectedMethod === "totp" ? " is-selected" : ""}`}
            disabled={pending || mfa.methods.some((method) => method.methodType === "totp")}
            onClick={() => {
              setSelectedMethod("totp");
              setError(null);
            }}
            type="button"
          >
            <strong>Use an authenticator app</strong>
            <span>Enter a rotating 6-digit code at sign-in.</span>
          </button>
        </div>
      )}

      <footer className="mfa-enrollment-footer">
        {recoveryCodes !== null ? (
          <button
            className="is-primary"
            disabled={!saved || pending}
            onClick={() => void acknowledge()}
            type="button"
          >
            {pending ? "Finishing..." : "I saved these codes"}
          </button>
        ) : choosingMethod ? (
          <>
            {required ? (
              <button className="mfa-sign-out" disabled={pending} onClick={onLogout} type="button">
                Sign out
              </button>
            ) : (
              <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
            )}
            <button
              className="is-primary"
              disabled={pending || selectedMethod === null}
              onClick={() => {
                if (selectedMethod === null) return;
                setMethodDraft(selectedMethod);
                setMethodLabel("");
                setError(null);
              }}
              type="button"
            >
              Continue
            </button>
          </>
        ) : required ? (
          <button className="mfa-sign-out" disabled={pending} onClick={onLogout} type="button">
            Sign out
          </button>
        ) : (
          <button disabled={pending} onClick={onCancel} type="button">Cancel</button>
        )}
      </footer>
    </section>
  );
}

function RecoveryCodesStep({
  codes,
  onSavedChange,
  saved,
}: {
  codes: string[];
  onSavedChange(saved: boolean): void;
  saved: boolean;
}) {
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const codeText = codes.join("\n");
  return (
    <div className="mfa-recovery-step">
      <ol className="mfa-recovery-codes">
        {codes.map((code) => <li key={code}><code>{code}</code></li>)}
      </ol>
      <div className="mfa-recovery-actions">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(codeText)
              .then(() => setCopyNotice("Copied."))
              .catch(() => setCopyNotice("Copy failed. Download the codes instead."));
          }}
          type="button"
        >
          Copy codes
        </button>
        <button onClick={() => downloadRecoveryCodes(codeText)} type="button">
          Download codes
        </button>
      </div>
      {copyNotice === null ? null : <p className="mfa-copy-notice" role="status">{copyNotice}</p>}
      <label className="mfa-saved-confirmation">
        <input
          checked={saved}
          onChange={(event) => onSavedChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>I saved these recovery codes somewhere secure.</span>
      </label>
    </div>
  );
}

function RecoveryCodeStatus({ remaining }: { remaining: number }) {
  const warning = MFA_RECOVERY_CODE_WARNING_COUNTS.includes(
    remaining as (typeof MFA_RECOVERY_CODE_WARNING_COUNTS)[number],
  );
  return (
    <p className={warning ? "mfa-recovery-status is-warning" : "mfa-recovery-status"}>
      <strong>{remaining}</strong> recovery {remaining === 1 ? "code" : "codes"} remaining.
      {remaining === 0 ? " Regenerate codes now." : remaining <= 3 ? " Regenerate soon." : ""}
    </p>
  );
}

export function enrollmentError(
  error: unknown,
  applicationHostname = typeof window === "undefined" ? "" : window.location.hostname,
): string {
  if (error instanceof MfaApiError && error.kind === "conflict") {
    return "That security method is already enrolled.";
  }
  if (error instanceof MfaApiError && error.kind === "throttled") {
    return `Too many attempts. Try again in ${error.retryAfterSeconds ?? 60} seconds.`;
  }
  if (error instanceof MfaApiError && error.kind === "invalid_challenge") {
    return "That verification was not accepted. Check the code and try again.";
  }
  if (error instanceof WebAuthnError) {
    if (
      error.code === "ERROR_CEREMONY_ABORTED" ||
      error.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"
    ) {
      return "Passkey setup was cancelled or timed out. No passkey was added.";
    }
    if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return "That security key is already registered to this account.";
    }
    if (error.code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT") {
      return "This security key cannot perform the requested verification. Configure its FIDO2 PIN or use another key.";
    }
    if (
      error.code === "ERROR_INVALID_DOMAIN" ||
      error.code === "ERROR_INVALID_RP_ID"
    ) {
      if (applicationHostname === "127.0.0.1" || applicationHostname === "::1") {
        return "Open http://localhost:5173 to set up a security key or passkey. Browsers do not accept an IP address for WebAuthn registration.";
      }
      return "Passkey setup is not configured for this application address.";
    }
    return "This authenticator could not create a passkey. Try another security key or authenticator.";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Passkey setup was cancelled or timed out. No passkey was added.";
  }
  if (
    error instanceof Error &&
    error.message === "WebAuthn is not supported in this browser"
  ) {
    return "This browser does not support passkeys or security keys.";
  }
  return "Account protection could not be updated. Try again.";
}

function downloadRecoveryCodes(content: string): void {
  const url = URL.createObjectURL(new Blob([
    "WCIB recovery codes\n\n",
    content,
    "\n\nEach code can be used once. Store this file securely.\n",
  ], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "wcib-recovery-codes.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}
