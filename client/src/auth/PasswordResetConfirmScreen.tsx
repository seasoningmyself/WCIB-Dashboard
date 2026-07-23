import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  getPasswordRequirementStatuses,
  isPasswordPolicySatisfied,
} from "../../../shared/password-policy.js";
import { passwordResetTokenSchema } from "../../../shared/password-reset.js";
import { AuthBrand } from "../ui/BrandIdentity.js";
import type { AuthApi } from "./api.js";
import { PasswordResetApiError } from "./api.js";
import { createSingleFlight } from "./login-state.js";

export type ConfirmResetError =
  | "invalid_token"
  | "mismatch"
  | "network"
  | "password_policy"
  | "server";

export function PasswordResetConfirmScreen({
  api,
  onComplete,
  onTokenConsumed,
  token,
}: {
  api: AuthApi;
  onComplete(): void;
  onTokenConsumed(): void;
  token: string | null;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<ConfirmResetError | null>(
    passwordResetTokenSchema.safeParse(token).success
      ? null
      : "invalid_token",
  );
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const singleFlight = useRef(createSingleFlight());
  const validToken = passwordResetTokenSchema.safeParse(token);

  useEffect(() => {
    setPassword("");
    setConfirmation("");
    setError(validToken.success ? null : "invalid_token");
  }, [token, validToken.success]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validatePasswordResetForm(password, confirmation);
    if (!validToken.success || validation !== null) {
      setError(validToken.success ? validation : "invalid_token");
      return;
    }
    const attempt = singleFlight.current.run(() =>
      api.confirmPasswordReset({
        password,
        token: validToken.data,
      }),
    );
    if (attempt === null) {
      return;
    }
    setPending(true);
    setError(null);
    void attempt
      .then(() => {
        setPassword("");
        setConfirmation("");
        onComplete();
      })
      .catch((reason: unknown) => {
        const nextError = confirmErrorKind(reason);
        if (nextError === "invalid_token") {
          setPassword("");
          setConfirmation("");
          onTokenConsumed();
        }
        setError(nextError);
      })
      .finally(() => setPending(false));
  };

  return (
    <PasswordResetConfirmPanel
      confirmation={confirmation}
      error={error}
      onConfirmationChange={setConfirmation}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
      password={password}
      pending={pending}
      tokenValid={validToken.success}
    />
  );
}

export function PasswordResetConfirmPanel({
  confirmation,
  error,
  onConfirmationChange,
  onPasswordChange,
  onSubmit,
  password,
  pending,
  tokenValid,
}: {
  confirmation: string;
  error: ConfirmResetError | null;
  onConfirmationChange(value: string): void;
  onPasswordChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  password: string;
  pending: boolean;
  tokenValid: boolean;
}) {
  const requirements = useMemo(
    () => getPasswordRequirementStatuses(password),
    [password],
  );

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="reset-confirm-title">
        <AuthBrand context="Account recovery" />
        <div className="login-heading">
          <h1 id="reset-confirm-title">Choose a new password</h1>
          <p>Set a new password for your WCIB account.</p>
        </div>

        {error === null ? null : (
          <div className="form-alert" role="alert">
            {confirmErrorText(error)}
          </div>
        )}

        {tokenValid ? (
          <form className="login-form" onSubmit={onSubmit}>
            <label htmlFor="reset-password">New password</label>
            <input
              autoComplete="new-password"
              disabled={pending}
              id="reset-password"
              maxLength={1_024}
              name="password"
              onChange={(event) =>
                onPasswordChange(event.currentTarget.value)
              }
              required
              type="password"
              value={password}
            />
            <ul
              className="password-requirements"
              aria-label="Password requirements"
              aria-live="polite"
            >
              {requirements.map((requirement) => (
                <li
                  className={requirement.isSatisfied ? "satisfied" : ""}
                  key={requirement.id}
                >
                  {requirement.label}
                </li>
              ))}
            </ul>

            <label htmlFor="reset-password-confirm">Confirm password</label>
            <input
              autoComplete="new-password"
              disabled={pending}
              id="reset-password-confirm"
              maxLength={1_024}
              name="passwordConfirmation"
              onChange={(event) =>
                onConfirmationChange(event.currentTarget.value)
              }
              required
              type="password"
              value={confirmation}
            />
            <button
              className="login-submit"
              disabled={pending}
              type="submit"
            >
              {pending ? "Updating..." : "Update password"}
            </button>
          </form>
        ) : (
          <a className="auth-primary-link" href="#/reset-password">
            Request a new reset link
          </a>
        )}
        <a className="auth-back-link" href="#/">
          Back to sign in
        </a>
      </section>
    </main>
  );
}

export function validatePasswordResetForm(
  password: string,
  confirmation: string,
): ConfirmResetError | null {
  if (!isPasswordPolicySatisfied(password)) {
    return "password_policy";
  }
  if (password !== confirmation) {
    return "mismatch";
  }
  return null;
}

function confirmErrorKind(error: unknown): ConfirmResetError {
  if (!(error instanceof PasswordResetApiError)) {
    return "server";
  }
  switch (error.kind) {
    case "invalid_token":
      return "invalid_token";
    case "network":
      return "network";
    case "validation":
      return "password_policy";
    case "invalid_response":
    case "server":
      return "server";
  }
}

function confirmErrorText(error: ConfirmResetError): string {
  switch (error) {
    case "invalid_token":
      return "This reset link is invalid, expired, or has already been used.";
    case "mismatch":
      return "The passwords do not match.";
    case "network":
      return "WCIB could not be reached. Check your connection and try again.";
    case "password_policy":
      return "Choose a password that meets every requirement.";
    case "server":
      return "Password reset is temporarily unavailable. Try again.";
  }
}
