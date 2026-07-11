import React, { useCallback, useEffect, useState } from "react";
import type { CurrentUser } from "../../shared/current-user.js";
import { createAuthApi, type AuthApi } from "./auth/api.js";
import { LoginScreen } from "./auth/LoginScreen.js";
import { AppShell } from "./shell/AppShell.js";

const defaultAuthApi = createAuthApi();

type AuthState =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "error" }
  | { status: "loading" }
  | { status: "signed_out" };

interface AppProps {
  authApi?: AuthApi;
}

export function App({ authApi = defaultAuthApi }: AppProps) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void authApi
      .restoreCurrentUser()
      .then((user) => {
        if (!active) {
          return;
        }
        setAuth(
          user === null
            ? { status: "signed_out" }
            : { status: "authenticated", user },
        );
      })
      .catch(() => {
        if (active) {
          setAuth({ status: "error" });
        }
      });
    return () => {
      active = false;
    };
  }, [authApi, restoreAttempt]);

  const handleAuthenticated = useCallback((user: CurrentUser) => {
    setAuth({ status: "authenticated", user });
  }, []);

  if (auth.status === "loading") {
    return <AuthLoading />;
  }
  if (auth.status === "error") {
    return (
      <main className="auth-status-page">
        <section className="auth-status" aria-labelledby="auth-error-title">
          <p className="auth-status-kicker">WCIB</p>
          <h1 id="auth-error-title">Unable to load your session</h1>
          <p>Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => {
              setAuth({ status: "loading" });
              setRestoreAttempt((attempt) => attempt + 1);
            }}
          >
            Try again
          </button>
        </section>
      </main>
    );
  }
  if (auth.status === "signed_out") {
    return (
      <LoginScreen api={authApi} onAuthenticated={handleAuthenticated} />
    );
  }

  return <AppShell user={auth.user} />;
}

function AuthLoading() {
  return (
    <main className="auth-status-page" aria-busy="true">
      <section className="auth-status" aria-labelledby="auth-loading-title">
        <p className="auth-status-kicker">WCIB</p>
        <h1 id="auth-loading-title">Loading your workspace</h1>
        <p>Checking your secure session...</p>
      </section>
    </main>
  );
}
