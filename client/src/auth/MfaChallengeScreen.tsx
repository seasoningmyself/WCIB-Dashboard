import { startAuthentication } from "@simplewebauthn/browser";
import React, { useEffect, useState, type FormEvent } from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import { totpCodeSchema } from "../../../shared/mfa-scaffold.js";
import { AuthBrand } from "../ui/BrandIdentity.js";
import { MfaApiError, type MfaApi } from "./mfa-api.js";

export function MfaChallengeScreen({
  api,
  onComplete,
  onLogout,
  user,
}: {
  api: MfaApi;
  onComplete(): Promise<void>;
  onLogout(): void;
  user: CurrentUser;
}) {
  const hasPasskey = user.mfa?.methods.some(
    (method) => method.methodType === "webauthn",
  ) === true;
  const hasTotp = user.mfa?.methods.some(
    (method) => method.methodType === "totp",
  ) === true;
  const [mode, setMode] = useState<"recovery" | "totp">(
    hasTotp ? "totp" : "recovery",
  );
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);

  useEffect(() => {
    if (retryAfterSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setRetryAfterSeconds((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [retryAfterSeconds > 0]);

  const finish = async (action: () => Promise<void>) => {
    if (pending || retryAfterSeconds > 0) return;
    setPending(true);
    setError(null);
    try {
      await action();
      await onComplete();
    } catch (caught) {
      const failure = challengeError(caught);
      setError(failure.message);
      setRetryAfterSeconds(failure.retryAfterSeconds);
      setCode("");
    } finally {
      setPending(false);
    }
  };

  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "totp" && !totpCodeSchema.safeParse(code).success) return;
    if (mode === "recovery" && code.trim().length < 20) return;
    void finish(() =>
      mode === "totp"
        ? api.loginWithTotp(code)
        : api.loginWithRecoveryCode(code),
    );
  };

  return (
    <main className="login-page">
      <section className="login-panel mfa-challenge-panel" aria-labelledby="mfa-challenge-title">
        <AuthBrand />
        <div className="login-heading">
          <h1 id="mfa-challenge-title">Verify it&apos;s you</h1>
          <p>Complete your second sign-in step for {user.email}.</p>
        </div>

        {error === null ? null : <div className="form-alert" role="alert">{error}</div>}

        {!hasPasskey && !hasTotp && (user.mfa?.recoveryCodesRemaining ?? 0) === 0 ? (
          <div className="form-alert" role="alert">
            Recovery codes are exhausted. Another administrator must reset MFA for this account.
          </div>
        ) : null}

        {hasPasskey ? (
          <button
            className="login-submit"
            disabled={pending || retryAfterSeconds > 0}
            onClick={() => {
              void finish(async () => {
                const started = await api.startPasskeyLogin();
                const credential = await startAuthentication({
                  optionsJSON: started.options,
                });
                await api.finishPasskeyLogin(started.challengeId, credential);
              });
            }}
            type="button"
          >
            {pending ? "Verifying..." : "Use security key or passkey"}
          </button>
        ) : null}

        {hasTotp || user.mfa?.recoveryCodesRemaining ? (
          <form className="login-form mfa-code-form" onSubmit={submitCode}>
            <div className="mfa-mode-tabs" role="tablist" aria-label="Verification method">
              {hasTotp ? (
                <button
                  aria-selected={mode === "totp"}
                  className={mode === "totp" ? "is-active" : undefined}
                  onClick={() => {
                    setMode("totp");
                    setCode("");
                    setError(null);
                  }}
                  role="tab"
                  type="button"
                >
                  Authenticator code
                </button>
              ) : null}
              {(user.mfa?.recoveryCodesRemaining ?? 0) > 0 ? (
                <button
                  aria-selected={mode === "recovery"}
                  className={mode === "recovery" ? "is-active" : undefined}
                  onClick={() => {
                    setMode("recovery");
                    setCode("");
                    setError(null);
                  }}
                  role="tab"
                  type="button"
                >
                  Recovery code
                </button>
              ) : null}
            </div>
            <label htmlFor="mfa-code">
              {mode === "totp" ? "6-digit code" : "Recovery code"}
            </label>
            <input
              autoComplete={mode === "totp" ? "one-time-code" : "off"}
              disabled={pending || retryAfterSeconds > 0}
              id="mfa-code"
              inputMode={mode === "totp" ? "numeric" : "text"}
              maxLength={mode === "totp" ? 6 : 128}
              onChange={(event) => setCode(event.currentTarget.value)}
              required
              value={code}
            />
            <button
              className="login-submit"
              disabled={pending || retryAfterSeconds > 0}
              type="submit"
            >
              {retryAfterSeconds > 0
                ? `Try again in ${retryAfterSeconds}s`
                : pending
                  ? "Verifying..."
                  : "Verify"}
            </button>
          </form>
        ) : null}

        <button className="mfa-sign-out" onClick={onLogout} type="button">
          Sign out
        </button>
      </section>
    </main>
  );
}

function challengeError(error: unknown): {
  message: string;
  retryAfterSeconds: number;
} {
  if (error instanceof MfaApiError && error.kind === "throttled") {
    return {
      message: "Too many attempts. Wait before trying again.",
      retryAfterSeconds: error.retryAfterSeconds ?? 60,
    };
  }
  if (error instanceof MfaApiError && error.kind === "invalid_challenge") {
    return { message: "That verification code was not accepted.", retryAfterSeconds: 0 };
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return { message: "Passkey verification was cancelled or timed out.", retryAfterSeconds: 0 };
  }
  return { message: "Verification could not be completed. Try again.", retryAfterSeconds: 0 };
}
