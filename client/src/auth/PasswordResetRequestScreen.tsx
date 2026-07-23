import React, { useRef, useState, type FormEvent } from "react";
import { AuthBrand } from "../ui/BrandIdentity.js";
import type { AuthApi } from "./api.js";
import { PasswordResetApiError } from "./api.js";
import { createSingleFlight } from "./login-state.js";

type RequestResetError = "network" | "server" | "validation";

export function PasswordResetRequestScreen({ api }: { api: AuthApi }) {
  const [email, setEmail] = useState("");
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<RequestResetError | null>(null);
  const [pending, setPending] = useState(false);
  const singleFlight = useRef(createSingleFlight());

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const attempt = singleFlight.current.run(() =>
      api.requestPasswordReset({ email }),
    );
    if (attempt === null) {
      return;
    }
    setPending(true);
    setError(null);
    void attempt
      .then(() => {
        setEmail("");
        setComplete(true);
      })
      .catch((reason: unknown) => {
        setError(requestErrorKind(reason));
      })
      .finally(() => setPending(false));
  };

  return (
    <PasswordResetRequestPanel
      complete={complete}
      email={email}
      error={error}
      onEmailChange={setEmail}
      onSubmit={handleSubmit}
      pending={pending}
    />
  );
}

export function PasswordResetRequestPanel({
  complete,
  email,
  error,
  onEmailChange,
  onSubmit,
  pending,
}: {
  complete: boolean;
  email: string;
  error: RequestResetError | null;
  onEmailChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  pending: boolean;
}) {
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="reset-request-title">
        <AuthBrand context="Account recovery" />
        <div className="login-heading">
          <h1 id="reset-request-title">Reset your password</h1>
          <p>Enter the email address for your WCIB account.</p>
        </div>

        {complete ? (
          <div className="form-success" role="status">
            If an account matches that email, reset instructions will be sent.
          </div>
        ) : null}
        {error === null ? null : (
          <div className="form-alert" role="alert">
            {requestErrorText(error)}
          </div>
        )}

        {complete ? null : (
          <form className="login-form" onSubmit={onSubmit}>
            <label htmlFor="reset-email">Email</label>
            <input
              autoComplete="username"
              disabled={pending}
              id="reset-email"
              inputMode="email"
              maxLength={320}
              name="email"
              onChange={(event) =>
                onEmailChange(event.currentTarget.value)
              }
              required
              type="email"
              value={email}
            />
            <button
              className="login-submit"
              disabled={pending}
              type="submit"
            >
              {pending ? "Sending..." : "Send reset instructions"}
            </button>
          </form>
        )}
        <a className="auth-back-link" href="#/">
          Back to sign in
        </a>
      </section>
    </main>
  );
}

function requestErrorKind(error: unknown): RequestResetError {
  if (!(error instanceof PasswordResetApiError)) {
    return "server";
  }
  return error.kind === "network"
    ? "network"
    : error.kind === "validation"
      ? "validation"
      : "server";
}

function requestErrorText(error: RequestResetError): string {
  switch (error) {
    case "network":
      return "WCIB could not be reached. Check your connection and try again.";
    case "validation":
      return "Enter a valid email address.";
    case "server":
      return "Password reset is temporarily unavailable. Try again.";
  }
}
