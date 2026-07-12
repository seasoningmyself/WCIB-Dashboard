import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../shared/current-user.js";
import { createApiClient } from "./api/client.js";
import { ApiClientProvider } from "./api/context.js";
import { createAuthApi, type AuthApi } from "./auth/api.js";
import { SignedOutExperience } from "./auth/SignedOutExperience.js";
import {
  createLogoutAction,
  createSessionBoundary,
  type SessionBoundary,
} from "./auth/session-boundary.js";
import { AppShell } from "./shell/AppShell.js";
import {
  resolveAuthorizedNavigation,
  resolveShellRoute,
} from "./shell/navigation.js";

const defaultAuthApi = createAuthApi();

type AuthState =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "error" }
  | { status: "loading" }
  | { returnPath: string | null; status: "signed_out" };

interface AppProps {
  authApi?: AuthApi;
}

export function App({ authApi = defaultAuthApi }: AppProps) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const boundaryRef = useRef<SessionBoundary | null>(null);
  if (boundaryRef.current === null) {
    boundaryRef.current = createSessionBoundary((event) => {
      setAuth({ returnPath: event.returnPath, status: "signed_out" });
    });
  }
  const boundary = boundaryRef.current;
  const protectedApi = useMemo(
    () =>
      createApiClient({
        onUnauthorized: () => {
          boundary.endSession("expired", currentHashPath());
        },
      }),
    [boundary],
  );
  const logoutAction = useMemo(
    () => createLogoutAction(() => authApi.logout(), boundary),
    [authApi, boundary],
  );

  useEffect(() => {
    let active = true;
    void authApi
      .restoreCurrentUser()
      .then((user) => {
        if (!active) {
          return;
        }
        if (user === null) {
          setAuth({ returnPath: null, status: "signed_out" });
          return;
        }
        boundary.beginSession();
        setAuth({ status: "authenticated", user });
      })
      .catch(() => {
        if (active) {
          setAuth({ status: "error" });
        }
      });
    return () => {
      active = false;
    };
  }, [authApi, boundary, restoreAttempt]);

  const handleAuthenticated = useCallback(
    (user: CurrentUser) => {
      const returnPath =
        auth.status === "signed_out" ? auth.returnPath : null;
      if (returnPath !== null) {
        const navigation = resolveAuthorizedNavigation(
          user.allowedNavigation,
        );
        window.location.hash =
          resolveShellRoute(returnPath, navigation).status === "ready"
            ? returnPath
            : "/";
      }
      boundary.beginSession();
      setAuth({ status: "authenticated", user });
    },
    [auth, boundary],
  );

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
      <SignedOutExperience
        api={authApi}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <ApiClientProvider boundary={boundary} client={protectedApi}>
      <AppShell
        onLogout={() => {
          logoutAction.run();
        }}
        user={auth.user}
      />
    </ApiClientProvider>
  );
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

function currentHashPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  const path = window.location.hash.slice(1);
  return path === "" ? "/" : path;
}
