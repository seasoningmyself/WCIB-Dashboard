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
import { RequiredPasswordChangeDialog } from "./auth/RequiredPasswordChangeDialog.js";
import { MfaChallengeScreen } from "./auth/MfaChallengeScreen.js";
import {
  RecommendedMfaEnrollment,
  RequiredMfaEnrollment,
} from "./auth/MfaEnrollment.js";
import { createMfaApi, type MfaApi } from "./auth/mfa-api.js";
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
const defaultMfaApi = createMfaApi();

type AuthState =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "error" }
  | { status: "loading" }
  | { returnPath: string | null; status: "signed_out" };

interface AppProps {
  authApi?: AuthApi;
  mfaApi?: MfaApi;
}

export function App({
  authApi = defaultAuthApi,
  mfaApi = defaultMfaApi,
}: AppProps) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [mfaPromptDismissed, setMfaPromptDismissed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const boundaryRef = useRef<SessionBoundary | null>(null);
  const temporaryPasswordRef = useRef<string | null>(null);
  if (boundaryRef.current === null) {
    boundaryRef.current = createSessionBoundary((event) => {
      temporaryPasswordRef.current = null;
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
    (user: CurrentUser, authenticatedPassword?: string) => {
      const returnPath =
        auth.status === "signed_out" ? auth.returnPath : null;
      const currentPath = currentHashPath();
      const nextPath = resolveAuthenticatedPath(
        user,
        currentPath,
        returnPath,
      );
      if (nextPath !== currentPath) {
        window.location.hash = nextPath;
      }
      boundary.beginSession();
      setMfaPromptDismissed(false);
      temporaryPasswordRef.current = user.passwordChangeRequired
        ? (authenticatedPassword ?? null)
        : null;
      setAuth({ status: "authenticated", user });
    },
    [auth, boundary],
  );
  const refreshAuthenticatedUser = useCallback(async () => {
    const user = await authApi.restoreCurrentUser();
    if (user === null) {
      boundary.endSession("expired", currentHashPath());
      throw new Error("Authenticated session ended");
    }
    boundary.beginSession();
    setAuth({ status: "authenticated", user });
    return user;
  }, [authApi, boundary]);

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

  if (auth.user.passwordChangeRequired) {
    return (
      <RequiredPasswordChangeDialog
        api={authApi}
        onChanged={(user) => {
          temporaryPasswordRef.current = null;
          boundary.beginSession();
          setMfaPromptDismissed(false);
          setAuth({ status: "authenticated", user });
        }}
        onLogout={() => {
          temporaryPasswordRef.current = null;
          logoutAction.run();
        }}
        temporaryPassword={temporaryPasswordRef.current}
        user={auth.user}
      />
    );
  }

  if (auth.user.authenticationState === "mfa_challenge") {
    return (
      <MfaChallengeScreen
        api={mfaApi}
        onComplete={async () => {
          await refreshAuthenticatedUser();
        }}
        onLogout={() => logoutAction.run()}
        user={auth.user}
      />
    );
  }

  if (
    auth.user.authenticationState === "mfa_enrollment" ||
    auth.user.authenticationState === "mfa_recovery" ||
    auth.user.mfa?.enrollmentRequired === true
  ) {
    return (
      <RequiredMfaEnrollment
        api={mfaApi}
        onComplete={async () => {
          await refreshAuthenticatedUser();
        }}
        onLogout={() => logoutAction.run()}
        user={auth.user}
      />
    );
  }

  if (
    auth.user.mfa?.adminRecommended === true &&
    !auth.user.mfa.enrolled &&
    !mfaPromptDismissed
  ) {
    return (
      <RecommendedMfaEnrollment
        api={mfaApi}
        onComplete={async () => {
          await refreshAuthenticatedUser();
        }}
        onDismiss={() => setMfaPromptDismissed(true)}
        user={auth.user}
      />
    );
  }

  return (
    <ApiClientProvider boundary={boundary} client={protectedApi}>
      <AppShell
        onLogout={() => {
          logoutAction.run();
        }}
        onUserChanged={(user) => setAuth({ status: "authenticated", user })}
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

export function resolveAuthenticatedPath(
  user: Readonly<CurrentUser>,
  currentPath: string,
  returnPath: string | null,
): string {
  const candidate = returnPath ?? currentPath;
  const navigation = resolveAuthorizedNavigation(user.allowedNavigation);
  return resolveShellRoute(candidate, navigation).status === "ready"
    ? candidate
    : "/";
}
