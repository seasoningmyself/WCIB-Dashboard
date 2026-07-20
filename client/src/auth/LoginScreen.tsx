import React, {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { LoginRequest } from "../../../shared/login.js";
import type { AuthApi } from "./api.js";
import {
  createSingleFlight,
  loginErrorText,
  loginFailureState,
  type LoginErrorKind,
} from "./login-state.js";

interface LoginScreenProps {
  api: AuthApi;
  onAuthenticated(user: CurrentUser, authenticatedPassword: string): void;
}

interface LoginPanelProps {
  email: string;
  error: LoginErrorKind | null;
  onEmailChange(value: string): void;
  onPasswordChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  password: string;
  pending: boolean;
  retryAfterSeconds?: number;
}

export function LoginScreen({ api, onAuthenticated }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LoginErrorKind | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const singleFlight = useRef(createSingleFlight());

  useEffect(() => {
    if (error !== null) {
      errorRef.current?.focus();
    }
  }, [error]);

  useEffect(() => {
    if (retryAfterSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setRetryAfterSeconds((current) => {
        if (current <= 1) {
          setError((value) => (value === "throttled" ? null : value));
          return 0;
        }
        return current - 1;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [retryAfterSeconds > 0]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (retryAfterSeconds > 0) return;
    const authenticatedPassword = password;
    const request: LoginRequest = { email, password: authenticatedPassword };
    const attempt = singleFlight.current.run(() => api.login(request));
    if (attempt === null) {
      return;
    }

    setPending(true);
    setError(null);
    void attempt
      .then((user) => onAuthenticated(user, authenticatedPassword))
      .catch((reason: unknown) => {
        const failure = loginFailureState(reason);
        setPassword(failure.password);
        setError(failure.error);
        setRetryAfterSeconds(failure.retryAfterSeconds);
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <LoginPanel
      email={email}
      error={error}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
      password={password}
      pending={pending}
      retryAfterSeconds={retryAfterSeconds}
      errorRef={errorRef}
    />
  );
}

export function LoginPanel({
  email,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  password,
  pending,
  retryAfterSeconds = 0,
  errorRef,
}: LoginPanelProps & { errorRef?: React.RefObject<HTMLDivElement> }) {
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand" aria-label="West Coast Insurance Brokers">
          <span className="login-brand-mark">WCIB</span>
          <span>West Coast Insurance Brokers</span>
        </div>
        <div className="login-heading">
          <h1 id="login-title">Sign in</h1>
          <p>Use your WCIB account to continue.</p>
        </div>

        {error === null ? null : (
          <div
            className="form-alert"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            {loginErrorText(error, retryAfterSeconds)}
          </div>
        )}

        <form className="login-form" onSubmit={onSubmit}>
          <label htmlFor="login-email">Email</label>
          <input
            autoComplete="username"
            disabled={pending || retryAfterSeconds > 0}
            id="login-email"
            inputMode="email"
            maxLength={320}
            name="email"
            onChange={(event) => onEmailChange(event.currentTarget.value)}
            required
            type="email"
            value={email}
          />

          <div className="password-label-row">
            <label htmlFor="login-password">Password</label>
            <a href="#/reset-password">Forgot password?</a>
          </div>
          <input
            autoComplete="current-password"
            disabled={pending || retryAfterSeconds > 0}
            id="login-password"
            maxLength={1_024}
            name="password"
            onChange={(event) => onPasswordChange(event.currentTarget.value)}
            required
            type="password"
            value={password}
          />

          <button
            className="login-submit"
            disabled={pending || retryAfterSeconds > 0}
            type="submit"
          >
            {pending
              ? "Signing in..."
              : retryAfterSeconds > 0
                ? `Try again in ${retryAfterSeconds}s`
                : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
